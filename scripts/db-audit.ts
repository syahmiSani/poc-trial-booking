/**
 * Standalone invariant check. Safe to run at any time, including mid-demo.
 *
 *   npm run db:audit
 *
 * Exits non-zero if any class is overbooked or if seats_taken has drifted from
 * the bookings actually holding a seat.
 */
import { pool } from "../src/db/pool.js";
import { seatAudit } from "../src/db/sql.js";

const rows = await seatAudit();
console.table(
  rows.map((r) => ({
    class: r.trial_class_id,
    seats_taken: r.seats_taken,
    capacity: r.capacity,
    holding: r.seat_holding_bookings,
    confirmed: r.confirmed_bookings,
    ok: r.ok,
  })),
);

const broken = rows.filter((r) => !r.ok);
await pool.end();

if (broken.length > 0) {
  console.error(`\n${broken.length} class(es) violate the seat invariant`);
  process.exit(1);
}
console.log("\nall invariants hold");
