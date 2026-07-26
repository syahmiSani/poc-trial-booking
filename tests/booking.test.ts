import { beforeEach, afterEach, describe, expect, test } from "vitest";
import { createBooking } from "../src/domain/bookings.js";
import { BookingError, isBookingError } from "../src/domain/errors.js";
import { resetDatabase } from "../src/db/sql.js";
import {
  expectInvariantsHold,
  seatsTaken,
  confirmedRoster,
} from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await expectInvariantsHold();
});

/** Runs `fn` n times truly concurrently and buckets the outcomes. */
async function raceFor<T>(
  n: number,
  fn: (i: number) => Promise<T>,
): Promise<{ ok: T[]; errors: BookingError[]; crashes: unknown[] }> {
  const settled = await Promise.allSettled(
    Array.from({ length: n }, (_, i) => fn(i)),
  );
  const ok: T[] = [];
  const errors: BookingError[] = [];
  const crashes: unknown[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") ok.push(r.value);
    else if (isBookingError(r.reason)) errors.push(r.reason);
    else crashes.push(r.reason);
  }
  return { ok, errors, crashes };
}

describe("createBooking — happy path", () => {
  test("reserves a seat and opens a hold", async () => {
    const before = await seatsTaken("TC-101");
    const booking = await createBooking({
      studentId: "S-10", // Jonas, P5 — wrong level for TC-101 (P4)
      trialClassId: "TC-102",
    });

    expect(booking.status).toBe("pending_payment");
    expect(booking.hold_expires_at).toBeInstanceOf(Date);
    expect(booking.hold_expires_at!.getTime()).toBeGreaterThan(Date.now());
    expect(await seatsTaken("TC-102")).toBe(4);
    expect(await seatsTaken("TC-101")).toBe(before);

    // A held seat is NOT a confirmed seat. The roster must not show Jonas.
    expect(await confirmedRoster("TC-102")).toEqual(["Chloe", "Darren", "Ethan"]);
  });
});

describe("createBooking — refusals", () => {
  test("rejects a duplicate booking for the same child and class", async () => {
    // Aiden is already confirmed on TC-101.
    await expect(
      createBooking({ studentId: "S-1", trialClassId: "TC-101" }),
    ).rejects.toMatchObject({ code: "DUPLICATE_BOOKING" });

    expect(await seatsTaken("TC-101")).toBe(1); // no seat consumed
  });

  test("rejects booking a full class", async () => {
    // Mira (S-13) is P3 and has no booking anywhere, so CLASS_FULL is the only
    // reason this can fail. Using a child already on TC-103 would trip the
    // duplicate rule first and pass for the wrong reason.
    await expect(
      createBooking({ studentId: "S-13", trialClassId: "TC-103" }),
    ).rejects.toMatchObject({ code: "CLASS_FULL" });
  });

  test("rejects a level mismatch", async () => {
    // Bella is P6; TC-102 is P5.
    await expect(
      createBooking({ studentId: "S-2", trialClassId: "TC-102" }),
    ).rejects.toMatchObject({ code: "LEVEL_MISMATCH" });
  });

  test("a refused booking leaves NO booking row and NO consumed seat", async () => {
    const before = await seatsTaken("TC-103");
    await expect(
      createBooking({ studentId: "S-13", trialClassId: "TC-103" }),
    ).rejects.toThrow();
    expect(await seatsTaken("TC-103")).toBe(before);
  });
});

describe("the last-seat race", () => {
  // TC-102 has 3 of 4 seats taken. R-1..R-20 are twenty DISTINCT unbooked P5
  // children, so every attempt is a genuine contender for the one free seat —
  // the duplicate index cannot quietly decide this for us.
  const racers = Array.from({ length: 20 }, (_, i) => `R-${i + 1}`);

  // A forced 200ms window guarantees every transaction reads the seat count
  // before any of them writes. Without it the outcome depends on scheduling
  // luck, and a concurrency test that passes by luck is worse than no test.
  const WIDE_WINDOW = 200;

  test("20 children, 1 seat, strategy=safe → exactly one winner", async () => {
    const { ok, errors, crashes } = await raceFor(20, (i) =>
      createBooking(
        { studentId: racers[i]!, trialClassId: "TC-102" },
        { strategy: "safe", raceWindowMs: WIDE_WINDOW },
      ),
    );

    // Exactly one seat existed, so exactly one caller may succeed — even with
    // the race window held deliberately wide open.
    expect(ok).toHaveLength(1);
    expect(await seatsTaken("TC-102")).toBe(4);

    // Everyone else got a clean, explainable refusal. Never a raw DB error.
    expect(crashes).toEqual([]);
    expect(errors).toHaveLength(19);
    for (const e of errors) expect(e.code).toBe("CLASS_FULL");
  });

  test("strategy=naive fails the identical test", async () => {
    // Same race, same window, wrong implementation. The naive path reads the
    // count, decides, then writes — so all twenty conclude a seat exists.
    //
    // What saves the roster is the CHECK constraint: Postgres rejects the
    // excess writes. So the observable damage is a pile of raw constraint
    // violations rather than an overbooked class — and that containment IS the
    // argument for putting the invariant in the database. Without the CHECK,
    // this test would put a 5th child in a 4-seat classroom.
    const { ok, crashes } = await raceFor(20, (i) =>
      createBooking(
        { studentId: racers[i]!, trialClassId: "TC-102" },
        { strategy: "naive", raceWindowMs: WIDE_WINDOW },
      ),
    );

    // The database held the line regardless of the bug above it.
    expect(await seatsTaken("TC-102")).toBeLessThanOrEqual(4);
    expect(ok.length).toBeLessThanOrEqual(1);

    // ...but naive leaked raw database errors to the caller, which safe never
    // does. This is the red-vs-green comparison the whole switch exists for.
    expect(crashes.length).toBeGreaterThan(0);
  });
});
