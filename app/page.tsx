"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type TrialClass = {
  id: string;
  subject: string;
  level: string;
  starts_at: string;
  teacher_name: string;
  seats_available: number;
};
type Student = { id: string; name: string; level: string; parent_name: string };

export default function BookPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<TrialClass[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  async function load() {
    const [c, s] = await Promise.all([
      fetch("/api/trial-classes").then((r) => r.json()),
      fetch("/api/students").then((r) => r.json()),
    ]);
    setClasses(c.classes);
    setStudents(s.students);
    if (!studentId && s.students[0]) setStudentId(s.students[0].id);
  }

  useEffect(() => {
    void load();
  }, []);

  async function book(trialClassId: string) {
    setBusy(trialClassId);
    setError(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentId, trialClassId }),
    });
    const json = await res.json();
    setBusy("");

    if (!res.ok) {
      // A full class is a normal answer, not a crash. The UI says so plainly.
      setError({ code: json.error, message: json.message });
      await load();
      return;
    }
    router.push(`/bookings/${json.booking.id}`);
  }

  const child = students.find((s) => s.id === studentId);

  return (
    <>
      <h1>Book a trial class</h1>
      <p className="hint">
        Trial classes are capped at 4 students. Seats shown here are advisory —
        the authoritative check happens in the database when you book.
      </p>

      <div className="card">
        <div className="row">
          <label htmlFor="student">Child</label>
          <select
            id="student"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.level}) — parent {s.parent_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "#e5a9a3" }}>
          <strong className="bad">{error.code}</strong>
          <div>{error.message}</div>
        </div>
      )}

      <h2>Available trial classes</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Class</th>
              <th>Subject</th>
              <th>Level</th>
              <th>Starts</th>
              <th>Teacher</th>
              <th>Seats</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => {
              const full = c.seats_available <= 0;
              const wrongLevel = child ? child.level !== c.level : false;
              return (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{c.subject}</td>
                  <td>{c.level}</td>
                  <td>{new Date(c.starts_at).toLocaleString()}</td>
                  <td>{c.teacher_name}</td>
                  <td className={full ? "full" : undefined}>
                    {c.seats_available} / 4
                  </td>
                  <td>
                    <button
                      onClick={() => book(c.id)}
                      disabled={busy === c.id || full || wrongLevel}
                      title={
                        wrongLevel
                          ? `${child?.name} is ${child?.level}, this class is ${c.level}`
                          : full
                            ? "no seats left"
                            : ""
                      }
                    >
                      {busy === c.id ? "Booking…" : "Book"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
