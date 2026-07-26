import { beforeEach, afterEach, describe, expect, test } from "vitest";
import { createBooking } from "../src/domain/bookings.js";
import { payBooking } from "../src/domain/payments.js";
import { CARD_TOKENS, mockProvider } from "../src/payments/mock.js";
import { pool } from "../src/db/pool.js";
import { resetDatabase } from "../src/db/sql.js";
import {
  expectInvariantsHold,
  seatsTaken,
  confirmedRoster,
  bookingStatus,
} from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  mockProvider.reset();
});

afterEach(async () => {
  await expectInvariantsHold();
});

const hold = () => createBooking({ studentId: "R-1", trialClassId: "TC-102" });

describe("successful payment", () => {
  test("confirms the booking and puts the child on the roster", async () => {
    const booking = await hold();
    const paid = await payBooking({
      bookingId: booking.id,
      cardToken: CARD_TOKENS.ok,
      idempotencyKey: "key-1",
    });

    expect(paid.status).toBe("confirmed");
    expect(paid.confirmed_at).toBeInstanceOf(Date);
    expect(await seatsTaken("TC-102")).toBe(4);
    expect(await confirmedRoster("TC-102")).toContain("Racer 1");
    expect(mockProvider.captureCount()).toBe(1);
  });

  test("captures only AFTER the booking is confirmed", async () => {
    const booking = await hold();
    await payBooking({
      bookingId: booking.id,
      cardToken: CARD_TOKENS.ok,
      idempotencyKey: "key-order",
    });

    const ops = mockProvider.calls.map((c) => c.op);
    expect(ops.indexOf("authorize")).toBeLessThan(ops.indexOf("capture"));
  });
});

describe("declined payment", () => {
  test("releases the seat and keeps the child off the roster", async () => {
    const booking = await hold();
    expect(await seatsTaken("TC-102")).toBe(4); // seat held during checkout

    await expect(
      payBooking({
        bookingId: booking.id,
        cardToken: CARD_TOKENS.declined,
        idempotencyKey: "key-declined",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_FAILED" });

    expect(await bookingStatus(booking.id)).toBe("payment_failed");
    expect(await seatsTaken("TC-102")).toBe(3); // seat returned
    expect(await confirmedRoster("TC-102")).not.toContain("Racer 1");

    // The money question: nothing was ever captured.
    expect(mockProvider.captureCount()).toBe(0);
  });

  test("records the failure reason for support to read", async () => {
    const booking = await hold();
    await expect(
      payBooking({
        bookingId: booking.id,
        cardToken: CARD_TOKENS.insufficientFunds,
        idempotencyKey: "key-funds",
      }),
    ).rejects.toThrow();

    const { rows } = await pool.query<{ status: string; failure_code: string }>(
      "SELECT status, failure_code FROM payment_attempts WHERE idempotency_key = 'key-funds'",
    );
    expect(rows[0]).toMatchObject({
      status: "failed",
      failure_code: "insufficient_funds",
    });
  });
});

describe("the seat is lost while the parent is paying", () => {
  test("voids the authorization and does NOT charge the parent", async () => {
    const booking = await hold();

    // Simulate the hold expiring and the seat going to someone else while the
    // parent sits on the payment screen.
    await pool.query(
      "UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1",
      [booking.id],
    );

    await expect(
      payBooking({
        bookingId: booking.id,
        cardToken: CARD_TOKENS.ok,
        idempotencyKey: "key-lost",
      }),
    ).rejects.toMatchObject({ code: "SEAT_LOST" });

    expect(await bookingStatus(booking.id)).toBe("cancelled");
    expect(await seatsTaken("TC-102")).toBe(3);

    // The assertion that matters most in this entire suite: the provider was
    // authorized and then VOIDED, and capture was never called.
    expect(mockProvider.captureCount()).toBe(0);
    expect(mockProvider.calls.map((c) => c.op)).toEqual(["authorize", "void"]);
  });
});

describe("idempotency", () => {
  test("paying twice charges once", async () => {
    const booking = await hold();
    const first = await payBooking({
      bookingId: booking.id,
      cardToken: CARD_TOKENS.ok,
      idempotencyKey: "key-dup",
    });
    const second = await payBooking({
      bookingId: booking.id,
      cardToken: CARD_TOKENS.ok,
      idempotencyKey: "key-dup",
    });

    expect(first.id).toBe(second.id);
    expect(second.status).toBe("confirmed");
    expect(mockProvider.captureCount()).toBe(1);
    expect(await seatsTaken("TC-102")).toBe(4);
  });

  test("a lost provider response does not create a second charge", async () => {
    const booking = await hold();

    // The provider authorized, then the response was lost in transit.
    await expect(
      payBooking({
        bookingId: booking.id,
        cardToken: CARD_TOKENS.timeout,
        idempotencyKey: "key-timeout",
      }),
    ).rejects.toThrow(/timed out/);

    // The parent retries with the SAME idempotency key.
    const paid = await payBooking({
      bookingId: booking.id,
      cardToken: CARD_TOKENS.timeout,
      idempotencyKey: "key-timeout",
    });

    expect(paid.status).toBe("confirmed");
    // One authorization reused, one capture. Not two of either.
    expect(mockProvider.captureCount()).toBe(1);
    expect(mockProvider.calls.filter((c) => c.op === "authorize")).toHaveLength(1);
  });
});
