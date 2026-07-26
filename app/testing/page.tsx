"use client";

import { useEffect, useState } from "react";

type Audit = {
  trial_class_id: string;
  capacity: number;
  seats_taken: number;
  seat_holding_bookings: number;
  confirmed_bookings: number;
  ok: boolean;
};

async function call(action: string, args: Record<string, unknown> = {}) {
  const res = await fetch("/api/testing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...args }),
  });
  return res.json();
}

export default function TestingConsole() {
  const [audit, setAudit] = useState<Audit[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const j = await call("audit");
    setAudit(j.audit ?? []);
  }

  useEffect(() => {
    void refresh();
  }, []);

  function say(line: string) {
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 40));
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    say(`▶ ${label}`);
    try {
      await fn();
    } catch (e) {
      say(`   error: ${String(e)}`);
    }
    await refresh();
    setBusy(false);
  }

  const race = (strategy: "safe" | "naive", n: number) =>
    run(`${n}-child race on TC-102 · strategy=${strategy}`, async () => {
      const j = await call("race", { n, strategy, raceWindowMs: 200 });
      if (!j.ok) return say(`   ${j.message}`);
      say(`   ${j.contenders} children raced for the last seat`);
      say(`   winners: ${j.won}   refused cleanly: ${j.refusedCleanly}   raw DB errors: ${j.rawDatabaseErrors}`);
      say(
        `   seats ${j.before.seats_taken}/${j.before.capacity} → ${j.after.seats_taken}/${j.after.capacity}   invariant: ${j.after.ok ? "OK" : "VIOLATED"}`,
      );
      say(
        strategy === "safe"
          ? "   exactly one winner, everyone else got a clean CLASS_FULL"
          : "   naive read the count then wrote — several passed the check, and the CHECK constraint had to reject them",
      );
    });

  return (
    <>
      <h1>Testing console</h1>
      <p className="hint">
        A race needs two requests <strong>overlapping</strong>, not two people.
        These buttons manufacture the overlap on demand, so one person at one
        laptop can drive every scenario in the brief. This page would not exist
        in production.
      </p>

      <h2>1 · The last-seat race</h2>
      <div className="card">
        <p className="hint">
          TC-102 has 3 of 4 seats taken. Each button fires N bookings
          simultaneously with a 200&nbsp;ms window held open, so every request
          reads the seat count before any of them writes.
        </p>
        <div className="row">
          <button disabled={busy} onClick={() => race("safe", 2)}>
            2 parents · safe
          </button>
          <button disabled={busy} onClick={() => race("safe", 20)}>
            20 parents · safe
          </button>
          <button className="secondary" disabled={busy} onClick={() => race("naive", 20)}>
            20 parents · naive (expected to break)
          </button>
        </div>
      </div>

      <h2>2 · Holds and expiry</h2>
      <div className="card">
        <p className="hint">
          Seats are reserved at selection with a 10-minute hold. Forcing a hold
          to expire lets you reach the seat-lost path without waiting.
        </p>
        <div className="row">
          <button
            disabled={busy}
            onClick={() =>
              run("release expired holds", async () => {
                const j = await call("expire-holds");
                say(`   ${j.message}`);
              })
            }
          >
            Run hold sweeper
          </button>
          <ExpireOne busy={busy} run={run} say={say} />
        </div>
      </div>

      <h2>3 · Reset</h2>
      <div className="card">
        <div className="row">
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              run("reset database", async () => {
                const j = await call("reset");
                say(`   ${j.message}`);
              })
            }
          >
            Reset and reseed
          </button>
          <span className="hint">
            Back to: TC-101 1/4 · TC-102 3/4 · TC-103 full · TC-104 expired hold
          </span>
        </div>
      </div>

      <h2>Live invariant check</h2>
      <div className="card">
        <p className="hint">
          <code>seats_taken ≤ capacity</code> and{" "}
          <code>seats_taken = bookings actually holding a seat</code>. If either
          is ever false, the row turns red — that is the bug this whole repo
          exists to prevent.
        </p>
        <table>
          <thead>
            <tr>
              <th>Class</th><th>Seats</th><th>Holding</th><th>Confirmed</th><th>Invariant</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.trial_class_id}>
                <td>{a.trial_class_id}</td>
                <td>{a.seats_taken} / {a.capacity}</td>
                <td>{a.seat_holding_bookings}</td>
                <td>{a.confirmed_bookings}</td>
                <td className={a.ok ? "ok" : "bad"}>{a.ok ? "OK" : "VIOLATED"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Log</h2>
      <pre>{log.length ? log.join("\n") : "Run a scenario above."}</pre>
    </>
  );
}

function ExpireOne({
  busy,
  run,
  say,
}: {
  busy: boolean;
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  say: (s: string) => void;
}) {
  const [id, setId] = useState("");
  return (
    <>
      <input
        placeholder="booking id"
        value={id}
        onChange={(e) => setId(e.target.value)}
        style={{ width: 300 }}
      />
      <button
        className="secondary"
        disabled={busy || !id}
        onClick={() =>
          run(`force hold to expire: ${id}`, async () => {
            const j = await call("expire-one", { bookingId: id });
            say(`   ${j.message}`);
          })
        }
      >
        Expire this hold
      </button>
    </>
  );
}
