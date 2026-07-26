/**
 * Schema-level invariants.
 *
 * These tests deliberately talk to Postgres directly rather than through the
 * booking service. The claim being tested is that the guarantees survive even
 * if the application layer is wrong, so routing them through the application
 * layer would test the wrong thing.
 */
import { beforeAll, afterEach, describe, expect, test } from "vitest";
import { pool, PG } from "../src/db/pool.js";
import { resetDatabase } from "../src/db/sql.js";
import { expectInvariantsHold, seatsTaken } from "./helpers/db.js";

beforeAll(async () => {
  await resetDatabase();
});

afterEach(async () => {
  // Any test that leaves the database inconsistent fails here, not later.
  await expectInvariantsHold();
});

async function expectPgError(fn: () => Promise<unknown>, code: string) {
  await expect(fn()).rejects.toMatchObject({ code });
}

describe("seed data", () => {
  test("is internally consistent", async () => {
    await expectInvariantsHold();
  });

  test("sets up the four cases the brief asks to demonstrate", async () => {
    // Scoped to the four fixture classes on purpose, the seed also carries a
    // wider timetable of open classes, and this assertion is about the special
    // states, not the schedule size.
    const { rows } = await pool.query<{ id: string; seats_taken: number; capacity: number }>(
      `SELECT id, seats_taken, capacity FROM trial_classes
        WHERE id IN ('TC-101','TC-102','TC-103','TC-104') ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: "TC-101", seats_taken: 1, capacity: 4 }, // seats available
      { id: "TC-102", seats_taken: 3, capacity: 4 }, // exactly 3, the race target
      { id: "TC-103", seats_taken: 4, capacity: 4 }, // full
      { id: "TC-104", seats_taken: 1, capacity: 4 }, // an expired hold
    ]);
  });
});

describe("overbooking", () => {
  test("the conditional UPDATE refuses a full class instead of overbooking", async () => {
    const res = await pool.query(
      `UPDATE trial_classes SET seats_taken = seats_taken + 1
        WHERE id = 'TC-103' AND seats_taken < capacity`,
    );
    // Zero rows is the entire mechanism: no seat, no error, no race.
    expect(res.rowCount).toBe(0);
    expect(await seatsTaken("TC-103")).toBe(4);
  });

  test("the database refuses even a forced overbook", async () => {
    await expectPgError(
      () =>
        pool.query(
          "UPDATE trial_classes SET seats_taken = seats_taken + 1 WHERE id = 'TC-103'",
        ),
      PG.CHECK_VIOLATION,
    );
    expect(await seatsTaken("TC-103")).toBe(4);
  });
});

describe("duplicate bookings", () => {
  test("a child cannot hold two live bookings for the same class", async () => {
    // Aiden (S-1) is already confirmed on TC-101.
    await expectPgError(
      () =>
        pool.query(
          `INSERT INTO bookings (id, student_id, trial_class_id, status, hold_expires_at)
           VALUES ('B-DUP', 'S-1', 'TC-101', 'pending_payment', now() + interval '10 min')`,
        ),
      PG.UNIQUE_VIOLATION,
    );
  });

  test("a failed payment does NOT block the parent from retrying", async () => {
    // Bella (S-2) has a payment_failed row on TC-104. A full unique index would
    // lock her out permanently after one declined card; the partial index must
    // let her through. This is the case a careless index gets wrong.
    const res = await pool.query(
      `INSERT INTO bookings (id, student_id, trial_class_id, status, hold_expires_at)
       VALUES ('B-RETRY', 'S-2', 'TC-104', 'pending_payment', now() + interval '10 min')`,
    );
    expect(res.rowCount).toBe(1);

    // Undo: this booking took no seat, so seats_taken must be corrected too or
    // the invariant sweep in afterEach will (correctly) fail.
    await pool.query("DELETE FROM bookings WHERE id = 'B-RETRY'");
  });
});

describe("booking row integrity", () => {
  test("a seat held for payment must carry an expiry", async () => {
    await expectPgError(
      () =>
        pool.query(
          `INSERT INTO bookings (id, student_id, trial_class_id, status)
           VALUES ('B-NOHOLD', 'S-10', 'TC-102', 'pending_payment')`,
        ),
      PG.CHECK_VIOLATION,
    );
  });

  test("a confirmed booking must record when it was confirmed", async () => {
    await expectPgError(
      () =>
        pool.query(
          `INSERT INTO bookings (id, student_id, trial_class_id, status)
           VALUES ('B-NOCONF', 'S-11', 'TC-102', 'confirmed')`,
        ),
      PG.CHECK_VIOLATION,
    );
  });
});

describe("the audit view", () => {
  test("detects counter drift, not just overbooking", async () => {
    // Take a seat without creating a booking, exactly the drift a buggy
    // release path would produce.
    await pool.query(
      "UPDATE trial_classes SET seats_taken = seats_taken + 1 WHERE id = 'TC-101'",
    );
    const { rows } = await pool.query<{ ok: boolean }>(
      "SELECT ok FROM class_seat_audit WHERE trial_class_id = 'TC-101'",
    );
    expect(rows[0]?.ok).toBe(false);

    await pool.query(
      "UPDATE trial_classes SET seats_taken = seats_taken - 1 WHERE id = 'TC-101'",
    );
  });
});
