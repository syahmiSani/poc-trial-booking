import Link from "next/link";
import { notFound } from "next/navigation";
import { getRoster } from "../../../src/domain/bookings.js";
import { RemoveStudent } from "./remove-student";

export const dynamic = "force-dynamic";

export default async function RosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const r = await getRoster(id);
  if (!r) notFound();

  const held = r.seats_taken - r.confirmed.length;

  return (
    <>
      <div className="page-head">
        <h1>
          {r.trial_class_id} · <span style={{ textTransform: "capitalize" }}>{r.subject}</span> {r.level}
        </h1>
        <p className="sub">
          {r.teacher_name} · {new Date(r.starts_at).toLocaleString("en-SG")}
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          Confirmed students
          <span className="spacer" />
          <span className="muted small">
            {r.confirmed.length} of {r.capacity}
            {held > 0 && ` · ${held} seat${held === 1 ? "" : "s"} held for checkout`}
          </span>
        </div>

        {r.confirmed.length === 0 ? (
          <div className="empty">No confirmed students yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 50 }}>#</th>
                <th>Student</th>
                <th>Level</th>
                <th>Confirmed</th>
                <th style={{ width: 200 }} />
              </tr>
            </thead>
            <tbody>
              {r.confirmed.map((c, i) => (
                <tr key={c.booking_id}>
                  <td className="muted">{i + 1}</td>
                  <td style={{ fontWeight: 550 }}>{c.student_name}</td>
                  <td>{c.level}</td>
                  <td className="muted small">
                    {new Date(c.confirmed_at).toLocaleString("en-SG")}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <RemoveStudent
                      bookingId={c.booking_id}
                      studentName={c.student_name}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="small muted" style={{ marginTop: 14 }}>
        Only confirmed bookings appear here. A held seat or a failed payment does
        not put a child in the room. Removing a student returns their seat to
        the pool immediately, refunds are out of scope in this build.
      </p>
      <p className="small" style={{ marginTop: 10 }}>
        <Link href="/roster">← All rosters</Link>
      </p>
    </>
  );
}
