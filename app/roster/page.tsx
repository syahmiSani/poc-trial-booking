"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function RosterIndex() {
  const [classes, setClasses] = useState<any[]>([]);

  useEffect(() => {
    void fetch("/api/trial-classes")
      .then((r) => r.json())
      .then((j) => setClasses(j.classes));
  }, []);

  return (
    <>
      <h1>Rosters</h1>
      <p className="hint">What the teacher reads before class starts.</p>
      <div className="card">
        <table>
          <thead>
            <tr><th>Class</th><th>Subject</th><th>Level</th><th>Seats left</th><th /></tr>
          </thead>
          <tbody>
            {classes.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td>{c.subject}</td>
                <td>{c.level}</td>
                <td>{c.seats_available}</td>
                <td><Link href={`/roster/${c.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
