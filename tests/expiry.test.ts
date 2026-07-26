import { beforeEach, afterEach, describe, expect, test } from "vitest";
import { createBooking } from "../src/domain/bookings.js";
import { payBooking } from "../src/domain/payments.js";
import { expireHolds } from "../src/jobs/expire-holds.js";
import { CARD_TOKENS, mockProvider } from "../src/payments/mock.js";
import { pool } from "../src/db/pool.js";
import { resetDatabase } from "../src/db/sql.js";
import { expectInvariantsHold, seatsTaken, bookingStatus } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  mockProvider.reset();
});

afterEach(async () => {
  await expectInvariantsHold();
});

describe("the hold sweeper", () => {
  test("releases the seat from the seeded expired hold", async () => {
    // TC-104 ships with one already-expired pending_payment booking.
    expect(await seatsTaken("TC-104")).toBe(1);

    const { expired } = await expireHolds();

    expect(expired).toBe(1);
    expect(await seatsTaken("TC-104")).toBe(0);
    expect(await bookingStatus("B-110")).toBe("expired");
  });

  test("leaves live holds alone", async () => {
    // Clear the seeded expired hold first, so this test measures only the
    // question it is asking: does a LIVE hold survive a sweep?
    await expireHolds();

    const booking = await createBooking({
      studentId: "R-1",
      trialClassId: "TC-102",
    });
    const { expired } = await expireHolds();

    expect(expired).toBe(0);
    expect(await bookingStatus(booking.id)).toBe("pending_payment");
    expect(await seatsTaken("TC-102")).toBe(4);
  });

  test("is idempotent, running it twice releases nothing extra", async () => {
    await expireHolds();
    const seatsAfterFirst = await seatsTaken("TC-104");

    const { expired } = await expireHolds();
    expect(expired).toBe(0);
    expect(await seatsTaken("TC-104")).toBe(seatsAfterFirst);
  });
});

describe("end-to-end: the scenario in the brief", () => {
  test("A's hold expires, B takes the last seat, A pays late and is not charged", async () => {
    // TC-102 has 3 of 4. Parent A (Jonas) grabs the last seat.
    const a = await createBooking({ studentId: "S-10", trialClassId: "TC-102" });
    expect(await seatsTaken("TC-102")).toBe(4);

    // Parent B (Kaya) is refused at SELECTION, she never reaches payment.
    await expect(
      createBooking({ studentId: "S-11", trialClassId: "TC-102" }),
    ).rejects.toMatchObject({ code: "CLASS_FULL" });

    // A wanders off. The hold lapses and the sweeper returns the seat.
    await pool.query(
      "UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1",
      [a.id],
    );
    await expireHolds();
    expect(await seatsTaken("TC-102")).toBe(3);

    // Now B books and pays successfully.
    const b = await createBooking({ studentId: "S-11", trialClassId: "TC-102" });
    const bPaid = await payBooking({
      bookingId: b.id,
      cardToken: CARD_TOKENS.ok,
      idempotencyKey: "key-b",
    });
    expect(bPaid.status).toBe("confirmed");

    // A finally returns and tries to pay for a seat that is no longer his.
    await expect(
      payBooking({
        bookingId: a.id,
        cardToken: CARD_TOKENS.ok,
        idempotencyKey: "key-a",
      }),
    ).rejects.toMatchObject({ code: "NOT_PENDING" });

    // Exactly one winner, and A was never charged.
    expect(await seatsTaken("TC-102")).toBe(4);
    expect(await bookingStatus(a.id)).toBe("expired");
    expect(mockProvider.captureCount()).toBe(1);
  });
});
