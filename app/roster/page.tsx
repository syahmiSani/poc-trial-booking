import Link from "next/link";
import { listAvailableClasses } from "../../src/domain/bookings.js";

export const dynamic = "force-dynamic";

export default async function RosterIndex() {
  const classes = await listAvailableClasses();

  return (
    <>
      <div className="page-head">
        <h1>Class rosters</h1>
        <p className="sub">What the teacher sees before class starts.</p>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Class</th>
              <th>Subject</th>
              <th>When</th>
              <th>Teacher</th>
              <th>Seats left</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td>
                  <span className={`subject-chip ${c.subject}`}>{c.subject}</span>{" "}
                  <span className="muted small">{c.level}</span>
                </td>
                <td>{new Date(c.starts_at).toLocaleString("en-SG")}</td>
                <td>{c.teacher_name}</td>
                <td className={c.seats_available === 0 ? "bad-text" : undefined}>
                  {c.seats_available} of 4
                </td>
                <td>
                  <Link href={`/roster/${c.id}`}>Open roster</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
