"use client";

import { useState } from "react";
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

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export function BookingPicker({
  classes,
  students,
}: {
  classes: TrialClass[];
  students: Student[];
}) {
  const router = useRouter();
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [subject, setSubject] = useState<"all" | "math" | "science">("all");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const child = students.find((s) => s.id === studentId);

  // A child can only sit a class at their own level, so classes for other
  // levels are not "disabled options" — they are not options at all. Showing
  // them greyed out just makes the parent scan past rows they can never pick.
  const eligible = classes.filter((c) => !child || c.level === child.level);
  const visible = eligible.filter((c) => subject === "all" || c.subject === subject);
  const counts = {
    all: eligible.length,
    math: eligible.filter((c) => c.subject === "math").length,
    science: eligible.filter((c) => c.subject === "science").length,
  };

  async function book(trialClassId: string) {
    setBusy(trialClassId);
    setError(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentId, trialClassId }),
    });
    const json = await res.json();

    if (!res.ok) {
      // A full class is a normal answer, not a crash — say so in plain words.
      setBusy("");
      setError({ code: json.error, message: json.message });
      router.refresh(); // pull fresh seat counts from the server
      return;
    }
    router.push(`/bookings/${json.booking.id}`);
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-pad">
          <label className="field" htmlFor="child">
            Who is this trial for?
          </label>
          <div className="row">
            <div className="grow">
              <select
                id="child"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.level} · {s.parent_name}
                  </option>
                ))}
              </select>
            </div>
            {child && (
              <span className="small muted">
                {counts.all} {child.level} class{counts.all === 1 ? "" : "es"}{" "}
                available for {child.name}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="note danger" style={{ marginBottom: 16 }}>
          <strong>
            {error.code === "CLASS_FULL"
              ? "That class just filled up"
              : error.code === "DUPLICATE_BOOKING"
                ? "Already booked"
                : error.code}
          </strong>
          <div style={{ marginTop: 2 }}>{error.message}</div>
        </div>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>
          Available times{child ? ` · ${child.level}` : ""}
        </h2>
        <span className="spacer" style={{ marginLeft: "auto" }} />
        <div className="segmented">
          {(["all", "math", "science"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={subject === s ? "seg active" : "seg"}
              onClick={() => setSubject(s)}
            >
              {s === "all" ? "All subjects" : s === "math" ? "Math" : "Science"}
              <span className="seg-count">{counts[s]}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && (
        <div className="card">
          <div className="empty">
            {counts.all === 0
              ? `No trial classes are scheduled for ${child?.level} right now.`
              : `No ${subject} classes for ${child?.level}. Try another subject.`}
          </div>
        </div>
      )}

      <div className="class-grid">
        {visible.map((c) => {
          const full = c.seats_available <= 0;
          const disabled = full || busy === c.id;

          return (
            <div key={c.id} className={`class-card${full ? " is-full" : ""}`}>
              <div className="class-top">
                <span className={`subject-chip ${c.subject}`}>{c.subject}</span>
                <div>
                  <div className="class-title">{fmt(c.starts_at)}</div>
                  <div className="class-meta">
                    {c.teacher_name} · {c.level} · 75 min · {c.id}
                  </div>
                </div>
              </div>

              <div className="class-foot">
                <span className="seats" aria-label={`${c.seats_available} of 4 seats free`}>
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`seat${i < c.seats_available ? " free" : ""}`}
                    />
                  ))}
                </span>
                <span className="small muted">
                  {full
                    ? "Class full"
                    : `${c.seats_available} of 4 seat${c.seats_available === 1 ? "" : "s"} left`}
                </span>
                <button
                  style={{ marginLeft: "auto" }}
                  onClick={() => book(c.id)}
                  disabled={disabled}
                  title={full ? "No seats left" : undefined}
                >
                  {busy === c.id ? <span className="spin" /> : "Book trial"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="small muted" style={{ marginTop: 16 }}>
        Seat counts here are advisory. The seat is confirmed against the database
        when you book, so a class can still fill up between the page loading and
        you clicking.
      </p>
    </>
  );
}
