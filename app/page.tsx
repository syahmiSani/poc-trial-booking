import { pool } from "../src/db/pool.js";
import { listAvailableClasses } from "../src/domain/bookings.js";
import { BookingPicker } from "./booking-picker";

export const dynamic = "force-dynamic";

/**
 * Server component: the class list and children are queried here and rendered
 * into the first HTML response.
 *
 * The earlier version was a client component that fetched on mount, which meant
 * blank page -> download JS -> hydrate -> two round trips -> content. Doing the
 * work on the server removes that waterfall entirely; only the interactive part
 * below ships as JavaScript.
 */
export default async function BookPage() {
  const [classes, students] = await Promise.all([
    listAvailableClasses(),
    pool
      .query(
        `SELECT s.id, s.name, s.level, p.name AS parent_name
           FROM students s JOIN parents p ON p.id = s.parent_id
          WHERE s.id NOT LIKE 'R-%'
          ORDER BY s.level, s.name`,
      )
      .then((r) => r.rows),
  ]);

  return (
    <>
      <div className="page-head">
        <h1>Book a trial class</h1>
        <p className="sub">
          Trial classes are capped at 4 students. Pick a child, then choose a
          time that matches their level.
        </p>
      </div>

      <BookingPicker
        classes={classes.map((c) => ({ ...c, starts_at: String(c.starts_at) }))}
        students={students}
      />
    </>
  );
}
