import { pool } from "../src/db/pool.js";
import { expireHolds } from "../src/jobs/expire-holds.js";
import { seatAudit } from "../src/db/sql.js";

const { expired } = await expireHolds();
console.log(`released ${expired} expired hold(s)`);

console.table(
  (await seatAudit()).map((r) => ({
    class: r.trial_class_id,
    seats: `${r.seats_taken}/${r.capacity}`,
    confirmed: r.confirmed_bookings,
    ok: r.ok,
  })),
);

await pool.end();
