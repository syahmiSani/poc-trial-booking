import type { Db } from "../db/pool.js";
import { config, type BookingStrategy } from "../config.js";
import { BookingError } from "./errors.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Seat allocation, the single most important function in this repo.
 *
 * Two implementations live here on purpose. `safe` is what ships; `naive` is
 * the textbook mistake, kept so the concurrency tests can be shown going RED
 * against it. A green test proves nothing unless the same test fails against
 * the obvious wrong implementation.
 *
 * Both honour RACE_WINDOW_MS at the same point, between deciding a seat is
 * available and writing that decision, so the comparison is fair.
 */
export type SeatOptions = {
  strategy?: BookingStrategy;
  /** Overrides RACE_WINDOW_MS. Tests use it to force a deterministic overlap. */
  raceWindowMs?: number;
};

export async function takeSeat(
  db: Db,
  trialClassId: string,
  opts: SeatOptions = {},
): Promise<void> {
  const strategy = opts.strategy ?? config.bookingStrategy;
  const windowMs = opts.raceWindowMs ?? config.raceWindowMs;
  return strategy === "naive"
    ? takeSeatNaive(db, trialClassId, windowMs)
    : takeSeatSafe(db, trialClassId, windowMs);
}

/**
 * SAFE. One statement. The read and the write are the same atomic operation,
 * so there is no window between them for a second transaction to slip into.
 *
 * If another transaction holds the row lock, this one blocks and then
 * re-evaluates `seats_taken < capacity` against the newly committed row
 * (Postgres READ COMMITTED). That re-evaluation is the whole guarantee: the
 * loser sees the winner's write and backs off with 0 rows affected.
 */
async function takeSeatSafe(
  db: Db,
  trialClassId: string,
  windowMs: number,
): Promise<void> {
  if (windowMs > 0) await sleep(windowMs);

  const res = await db.query(
    `UPDATE trial_classes
        SET seats_taken = seats_taken + 1
      WHERE id = $1 AND seats_taken < capacity`,
    [trialClassId],
  );

  if (res.rowCount === 0) {
    // Either the class is full or it does not exist; the caller has already
    // established that it exists, so this is genuinely "full".
    throw new BookingError("CLASS_FULL", "no seats remaining");
  }
}

/**
 * NAIVE, DO NOT COPY. Kept only as a test fixture.
 *
 * Reads the count, decides, then writes. Under concurrency two transactions
 * both read 3-of-4, both conclude a seat exists, and both write. Nobody
 * "loses the race", they both win, and the class ends up with 5 children.
 *
 * Note what happens in this repo when it does: the CHECK constraint on
 * trial_classes rejects the 5th seat, so the damage is contained to a failed
 * transaction rather than a corrupted roster. That containment is exactly what
 * putting the invariant in the database buys, and it is why the naive path
 * produces ugly errors here instead of an overbooked class.
 */
async function takeSeatNaive(
  db: Db,
  trialClassId: string,
  windowMs: number,
): Promise<void> {
  // Counts CONFIRMED bookings only, ignoring seats already held by parents
  // mid-checkout. This is the actual mistake people ship: "how many children
  // are on the roster?" is not the same question as "how many seats are gone?"
  const { rows } = await db.query<{ taken: number; capacity: number }>(
    `SELECT
       (SELECT count(*)::int
          FROM bookings
         WHERE trial_class_id = $1
           AND status = 'confirmed') AS taken,
       capacity
     FROM trial_classes WHERE id = $1`,
    [trialClassId],
  );

  const row = rows[0];
  if (!row) throw new BookingError("CLASS_NOT_FOUND");
  if (row.taken >= row.capacity) {
    throw new BookingError("CLASS_FULL", "no seats remaining");
  }

  // The window. In production this is microseconds; RACE_WINDOW_MS widens it
  // so a human can drive two browser tabs into it.
  if (windowMs > 0) await sleep(windowMs);

  await db.query(
    "UPDATE trial_classes SET seats_taken = seats_taken + 1 WHERE id = $1",
    [trialClassId],
  );
}

/**
 * Release a seat. Called on every transition OUT of a seat-holding status.
 *
 * Guarded by `seats_taken > 0` so a double-release can never drive the counter
 * negative, and the callers only ever invoke it when a status change actually
 * took effect, so it runs exactly once per released seat.
 */
export async function releaseSeat(db: Db, trialClassId: string): Promise<void> {
  await db.query(
    `UPDATE trial_classes
        SET seats_taken = seats_taken - 1
      WHERE id = $1 AND seats_taken > 0`,
    [trialClassId],
  );
}
