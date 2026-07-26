import { pool, withTransaction } from "../db/pool.js";
import { BookingError } from "./errors.js";
import { releaseSeat } from "./seats.js";
import { mockProvider } from "../payments/mock.js";
import type { PaymentProvider } from "../payments/provider.js";
import type { Booking } from "./bookings.js";

/**
 * Take payment for a held booking.
 *
 * The ordering is the entire safety argument, so it is worth stating plainly:
 *
 *   authorize  ->  re-verify the seat INSIDE a transaction  ->  capture
 *
 * Money is only ever captured AFTER a booking row has reached 'confirmed' in a
 * committed transaction. If the seat is gone by the time we get here, because
 * the hold expired and someone else took it, the authorization is voided and
 * the parent is never charged. There is no path in this function that captures
 * first and asks questions later.
 */
export async function payBooking(
  input: { bookingId: string; cardToken: string; idempotencyKey: string },
  deps: { provider?: PaymentProvider } = {},
): Promise<Booking> {
  const provider = deps.provider ?? mockProvider;

  const booking = await loadBooking(input.bookingId);
  if (!booking) throw new BookingError("BOOKING_NOT_FOUND");

  // Replaying a payment for an already-confirmed booking is a success, not an
  // error. Double-submits and redelivered webhooks land here.
  if (booking.status === "confirmed") return booking;
  if (booking.status !== "pending_payment") {
    throw new BookingError(
      "NOT_PENDING",
      `booking is ${booking.status}, not awaiting payment`,
    );
  }

  const amountCents = await priceOf(booking.trial_class_id);

  const attemptId = await recordAttempt({
    bookingId: booking.id,
    idempotencyKey: input.idempotencyKey,
    amountCents,
    cardToken: input.cardToken,
  });

  // ---- 1. authorize (funds held, NOT taken) --------------------------------
  const auth = await provider.authorize({
    amountCents,
    currency: "SGD",
    cardToken: input.cardToken,
    idempotencyKey: input.idempotencyKey,
  });

  if (auth.status === "failed") {
    await failBooking(booking, auth.failureCode ?? "declined", attemptId, auth.id);
    throw new BookingError("PAYMENT_FAILED", auth.failureCode ?? "declined");
  }

  // ---- 2. confirm, or discover the seat is gone ----------------------------
  const confirmed = await withTransaction(async (db) => {
    const { rows } = await db.query<Booking>(
      "SELECT * FROM bookings WHERE id = $1 FOR UPDATE",
      [booking.id],
    );
    const current = rows[0];
    if (!current) throw new BookingError("BOOKING_NOT_FOUND");

    // Someone else confirmed it while we were at the provider.
    if (current.status === "confirmed") return current;

    const holdValid =
      current.status === "pending_payment" &&
      current.hold_expires_at !== null &&
      current.hold_expires_at.getTime() > Date.now();

    if (!holdValid) {
      // The seat is gone. Give it up cleanly and, critically, do NOT capture.
      if (current.status === "pending_payment") {
        await db.query(
          `UPDATE bookings
              SET status = 'cancelled', cancelled_reason = 'seat_lost',
                  hold_expires_at = NULL
            WHERE id = $1`,
          [current.id],
        );
        await releaseSeat(db, current.trial_class_id);
      }
      return null;
    }

    const { rows: updated } = await db.query<Booking>(
      `UPDATE bookings
          SET status = 'confirmed', confirmed_at = now(), hold_expires_at = NULL
        WHERE id = $1
        RETURNING *`,
      [current.id],
    );
    return updated[0]!;
  });

  if (confirmed === null) {
    await provider.voidAuth(auth.id);
    await markAttempt(attemptId, "voided", auth.id);
    throw new BookingError("SEAT_LOST", "this seat was taken while you paid");
  }

  // ---- 3. capture (money actually moves, and only now) ---------------------
  await provider.capture(auth.id, input.idempotencyKey);
  await markAttempt(attemptId, "captured", auth.id);

  return confirmed;
}

// ---------------------------------------------------------------------------

async function loadBooking(id: string): Promise<Booking | null> {
  const { rows } = await pool.query<Booking>(
    "SELECT * FROM bookings WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

async function priceOf(trialClassId: string): Promise<number> {
  const { rows } = await pool.query<{ price_cents: number }>(
    "SELECT price_cents FROM trial_classes WHERE id = $1",
    [trialClassId],
  );
  if (!rows[0]) throw new BookingError("CLASS_NOT_FOUND");
  return rows[0].price_cents;
}

async function recordAttempt(input: {
  bookingId: string;
  idempotencyKey: string;
  amountCents: number;
  cardToken: string;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO payment_attempts
       (booking_id, idempotency_key, amount_cents, status, card_token)
     VALUES ($1, $2, $3, 'unknown', $4)
     ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [input.bookingId, input.idempotencyKey, input.amountCents, input.cardToken],
  );
  return rows[0]!.id;
}

async function markAttempt(
  attemptId: string,
  status: "captured" | "voided" | "failed" | "authorized",
  providerRef: string,
  failureCode?: string,
): Promise<void> {
  await pool.query(
    `UPDATE payment_attempts
        SET status = $2, provider_ref = $3, failure_code = $4
      WHERE id = $1`,
    [attemptId, status, providerRef, failureCode ?? null],
  );
}

/** Decline: release the seat in the same transaction as the status change. */
async function failBooking(
  booking: Booking,
  failureCode: string,
  attemptId: string,
  providerRef: string,
): Promise<void> {
  await withTransaction(async (db) => {
    const { rowCount } = await db.query(
      `UPDATE bookings
          SET status = 'payment_failed', cancelled_reason = $2,
              hold_expires_at = NULL
        WHERE id = $1 AND status = 'pending_payment'`,
      [booking.id, failureCode],
    );
    // Only release if THIS call is the one that changed the status, so a
    // concurrent expiry sweep cannot cause the seat to be released twice.
    if (rowCount === 1) await releaseSeat(db, booking.trial_class_id);
  });
  await markAttempt(attemptId, "failed", providerRef, failureCode);
}
