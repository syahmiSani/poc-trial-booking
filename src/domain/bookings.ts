import { config, type BookingStrategy } from "../config.js";
import { isPgError, PG, withTransaction, pool } from "../db/pool.js";
import { BookingError } from "./errors.js";
import { releaseSeat, takeSeat } from "./seats.js";

export type BookingStatus =
  | "pending_payment"
  | "confirmed"
  | "payment_failed"
  | "expired"
  | "cancelled";

export type Booking = {
  id: string;
  student_id: string;
  trial_class_id: string;
  status: BookingStatus;
  hold_expires_at: Date | null;
  confirmed_at: Date | null;
  cancelled_reason: string | null;
};

/**
 * Reserve a seat and open a checkout window.
 *
 * The seat is taken HERE, at selection — not when payment completes. That is
 * the product decision that stops two parents from ever reaching the payment
 * screen for the same last seat. It costs a little availability (a held seat
 * sits idle for up to HOLD_TTL_SECONDS if the parent walks away) and buys the
 * guarantee that matters: a live class with a teacher never gets a 5th child.
 *
 * Everything below happens in ONE transaction, so a failure at any point
 * leaves neither a booking row nor a consumed seat.
 */
export async function createBooking(
  input: { studentId: string; trialClassId: string },
  opts: { strategy?: BookingStrategy; raceWindowMs?: number } = {},
): Promise<Booking> {
  return withTransaction(async (db) => {
    const { rows: classRows } = await db.query<{ level: string }>(
      "SELECT level FROM trial_classes WHERE id = $1",
      [input.trialClassId],
    );
    const trialClass = classRows[0];
    if (!trialClass) throw new BookingError("CLASS_NOT_FOUND");

    const { rows: studentRows } = await db.query<{ level: string }>(
      "SELECT level FROM students WHERE id = $1",
      [input.studentId],
    );
    const student = studentRows[0];
    if (!student) throw new BookingError("STUDENT_NOT_FOUND");

    if (student.level !== trialClass.level) {
      throw new BookingError(
        "LEVEL_MISMATCH",
        `student is ${student.level}, class is ${trialClass.level}`,
      );
    }

    // Insert first, so the partial unique index rejects a duplicate before we
    // bother touching the seat counter.
    let booking: Booking;
    try {
      const { rows } = await db.query<Booking>(
        `INSERT INTO bookings (student_id, trial_class_id, status, hold_expires_at)
         VALUES ($1, $2, 'pending_payment', now() + ($3 || ' seconds')::interval)
         RETURNING *`,
        [input.studentId, input.trialClassId, config.holdTtlSeconds],
      );
      booking = rows[0]!;
    } catch (err) {
      if (isPgError(err, PG.UNIQUE_VIOLATION)) {
        throw new BookingError(
          "DUPLICATE_BOOKING",
          "this child already has an active booking for this class",
        );
      }
      throw err;
    }

    // Throws CLASS_FULL — which rolls back the insert above.
    await takeSeat(db, input.trialClassId, opts);

    return booking;
  });
}

/**
 * Remove a child from a class and return their seat to the pool.
 *
 * Used by the admin/teacher roster view. Two details make this safe:
 *
 *  1. The status change and the seat release happen in the SAME transaction,
 *     so the counter can never disagree with the bookings.
 *  2. The UPDATE is guarded by the current status, so it affects one row or
 *     zero. A double-clicked Remove button releases one seat, not two — which
 *     would otherwise silently overbook the class later on.
 *
 * Refunds are out of scope. A cancelled booking that was already captured is
 * flagged here and would be handed to a refund flow in a real build.
 */
export async function cancelBooking(
  bookingId: string,
  reason = "removed_by_admin",
): Promise<{ booking: Booking; refundDue: boolean }> {
  return withTransaction(async (db) => {
    const { rows } = await db.query<Booking>(
      "SELECT * FROM bookings WHERE id = $1 FOR UPDATE",
      [bookingId],
    );
    const current = rows[0];
    if (!current) throw new BookingError("BOOKING_NOT_FOUND");

    const heldSeat =
      current.status === "confirmed" || current.status === "pending_payment";
    if (!heldSeat) {
      throw new BookingError(
        "NOT_PENDING",
        `booking is already ${current.status}`,
      );
    }

    const { rows: updated, rowCount } = await db.query<Booking>(
      `UPDATE bookings
          SET status = 'cancelled', cancelled_reason = $2, hold_expires_at = NULL
        WHERE id = $1 AND status IN ('pending_payment', 'confirmed')
        RETURNING *`,
      [bookingId, reason],
    );

    // Release only if THIS call is the one that changed the status.
    if (rowCount === 1) await releaseSeat(db, current.trial_class_id);

    return {
      booking: updated[0]!,
      refundDue: current.status === "confirmed",
    };
  });
}

export async function getBooking(id: string): Promise<Booking | null> {
  const { rows } = await pool.query<Booking>(
    "SELECT * FROM bookings WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export type RosterEntry = {
  booking_id: string;
  student_name: string;
  level: string;
  confirmed_at: Date;
};

/**
 * The teacher's view. Confirmed bookings only — a pending hold is not a child
 * in the room, and a failed payment certainly is not.
 */
export async function getRoster(trialClassId: string): Promise<{
  trial_class_id: string;
  subject: string;
  level: string;
  starts_at: Date;
  teacher_name: string;
  capacity: number;
  seats_taken: number;
  confirmed: RosterEntry[];
} | null> {
  const { rows: classRows } = await pool.query(
    "SELECT * FROM trial_classes WHERE id = $1",
    [trialClassId],
  );
  const cls = classRows[0];
  if (!cls) return null;

  const { rows: confirmed } = await pool.query<RosterEntry>(
    `SELECT b.id AS booking_id, s.name AS student_name, s.level, b.confirmed_at
       FROM bookings b
       JOIN students s ON s.id = b.student_id
      WHERE b.trial_class_id = $1 AND b.status = 'confirmed'
      ORDER BY b.confirmed_at`,
    [trialClassId],
  );

  return {
    trial_class_id: cls.id,
    subject: cls.subject,
    level: cls.level,
    starts_at: cls.starts_at,
    teacher_name: cls.teacher_name,
    capacity: cls.capacity,
    seats_taken: cls.seats_taken,
    confirmed,
  };
}

export async function listAvailableClasses(): Promise<
  Array<{
    id: string;
    subject: string;
    level: string;
    starts_at: Date;
    teacher_name: string;
    seats_available: number;
  }>
> {
  const { rows } = await pool.query(
    `SELECT id, subject, level, starts_at, teacher_name,
            (capacity - seats_taken) AS seats_available
       FROM trial_classes
      ORDER BY starts_at`,
  );
  // seats_available is ADVISORY. The UI uses it to hide full classes; the
  // authoritative check happens in createBooking, inside a transaction.
  return rows;
}
