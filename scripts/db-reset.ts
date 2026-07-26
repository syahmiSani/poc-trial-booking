import { pool } from "../src/db/pool.js";
import { resetDatabase, seatAudit } from "../src/db/sql.js";

const start = Date.now();
await resetDatabase();

const rows = await seatAudit();
console.log(`database reset and seeded in ${Date.now() - start}ms\n`);
console.table(
  rows.map((r) => ({
    class: r.trial_class_id,
    seats: `${r.seats_taken}/${r.capacity}`,
    confirmed: r.confirmed_bookings,
    ok: r.ok,
  })),
);

const broken = rows.filter((r) => !r.ok);
if (broken.length > 0) {
  console.error("\nINVARIANT VIOLATED IN SEED DATA", broken);
  await pool.end();
  process.exit(1);
}

await pool.end();
