"use client";

import { use, useEffect, useState } from "react";

export default function RosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [r, setR] = useState<any>(null);

  useEffect(() => {
    void fetch(`/api/classes/${id}/roster`)
      .then((res) => res.json())
      .then(setR);
  }, [id]);

  if (!r || r.error) return <p>{r?.error ?? "Loading…"}</p>;

  return (
    <>
      <h1>
        Roster — {r.trial_class_id} · {r.subject} {r.level}
      </h1>
      <p className="hint">
        {r.teacher_name} · {new Date(r.starts_at).toLocaleString()} ·{" "}
        <strong>
          {r.confirmed.length} of {r.capacity} confirmed
        </strong>{" "}
        ({r.seats_taken} seat{r.seats_taken === 1 ? "" : "s"} taken, including
        any held for checkout)
      </p>

      <div className="card">
        {r.confirmed.length === 0 ? (
          <p className="hint">No confirmed students yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>#</th><th>Student</th><th>Level</th><th>Confirmed at</th></tr>
            </thead>
            <tbody>
              {r.confirmed.map((c: any, i: number) => (
                <tr key={c.booking_id}>
                  <td>{i + 1}</td>
                  <td>{c.student_name}</td>
                  <td>{c.level}</td>
                  <td>{new Date(c.confirmed_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="hint">
        Only confirmed bookings appear here. Held seats and failed payments do
        not put a child in the room.
      </p>
    </>
  );
}
