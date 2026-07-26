import { expect } from "vitest";
import { pool } from "../../src/db/pool.js";
import { resetDatabase, seatAudit } from "../../src/db/sql.js";

export { resetDatabase };

/**
 * The assertion that runs after every single test.
 *
 * It checks the two things that must never be false, for EVERY class — not
 * just the one the test touched:
 *   1. no class is overbooked
 *   2. seats_taken matches the bookings actually holding a seat
 *
 * A test that passes its own assertions while corrupting an unrelated class
 * still fails here, which is the point.
 */
export async function expectInvariantsHold(): Promise<void> {
  const rows = await seatAudit();
  const broken = rows.filter((r) => !r.ok);
  expect(
    broken,
    `invariant violated:\n${JSON.stringify(broken, null, 2)}`,
  ).toEqual([]);
}

export async function seatsTaken(classId: string): Promise<number> {
  const { rows } = await pool.query<{ seats_taken: number }>(
    "SELECT seats_taken FROM trial_classes WHERE id = $1",
    [classId],
  );
  if (!rows[0]) throw new Error(`no such trial class: ${classId}`);
  return rows[0].seats_taken;
}

export async function confirmedRoster(classId: string): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT s.name
       FROM bookings b
       JOIN students s ON s.id = b.student_id
      WHERE b.trial_class_id = $1 AND b.status = 'confirmed'
      ORDER BY s.name`,
    [classId],
  );
  return rows.map((r) => r.name);
}

export async function bookingStatus(bookingId: string): Promise<string | null> {
  const { rows } = await pool.query<{ status: string }>(
    "SELECT status FROM bookings WHERE id = $1",
    [bookingId],
  );
  return rows[0]?.status ?? null;
}
