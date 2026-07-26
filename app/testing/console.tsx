"use client";

import { useState } from "react";

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

export function TestingConsole({ initialAudit }: { initialAudit: Audit[] }) {
  const [audit, setAudit] = useState<Audit[]>(initialAudit);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [holdId, setHoldId] = useState("");

  const say = (line: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString("en-SG")}  ${line}`, ...l].slice(0, 60));

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    say(`▶ ${label}`);
    try {
      await fn();
    } catch (e) {
      say(`  error: ${String(e)}`);
    }
    setAudit((await call("audit")).audit ?? []);
    setBusy(false);
  }

  const race = (strategy: "safe" | "naive", n: number) =>
    run(`${n} parents race for the last seat on TC-102 · ${strategy}`, async () => {
      const j = await call("race", { n, strategy, raceWindowMs: 200 });
      if (!j.ok) return say(`  ${j.message}`);
      say(`  contenders ${j.contenders}   winners ${j.won}   refused cleanly ${j.refusedCleanly}   raw DB errors ${j.rawDatabaseErrors}`);
      say(`  seats ${j.before.seats_taken}/${j.before.capacity} → ${j.after.seats_taken}/${j.after.capacity}   invariant ${j.after.ok ? "OK" : "VIOLATED"}`);
      say(
        strategy === "safe"
          ? "  one winner; everyone else got a clean CLASS_FULL, never a crash"
          : "  naive read the count then wrote — many passed the check and the CHECK constraint had to reject them",
      );
    });

  const violations = audit.filter((a) => !a.ok).length;

  return (
    <>
      <div className="page-head">
        <h1>Testing console</h1>
        <p className="sub">
          A race needs two requests <strong>overlapping</strong>, not two people.
          These controls manufacture the overlap on demand, so one person can
          drive every scenario in the brief. This page would not ship to
          production.
        </p>
      </div>

      <div className="card">
        <div className="card-head">1 · The last-seat race</div>
        <div className="card-pad">
          <p className="small muted" style={{ marginTop: 0 }}>
            TC-102 has 3 of 4 seats taken. Each button fires N bookings at once,
            holding a 200&nbsp;ms window open so every request reads the seat
            count before any of them writes.
          </p>
          <div className="row">
            <button disabled={busy} onClick={() => race("safe", 2)}>
              2 parents · safe
            </button>
            <button disabled={busy} onClick={() => race("safe", 20)}>
              20 parents · safe
            </button>
            <button className="ghost" disabled={busy} onClick={() => race("naive", 20)}>
              20 parents · naive (expected to break)
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">2 · Holds and expiry</div>
        <div className="card-pad">
          <p className="small muted" style={{ marginTop: 0 }}>
            Seats are reserved at selection with a 10-minute hold. Force a hold
            to expire to reach the seat-lost path without waiting.
          </p>
          <div className="row">
            <button
              disabled={busy}
              onClick={() =>
                run("run hold sweeper", async () => {
                  say(`  ${(await call("expire-holds")).message}`);
                })
              }
            >
              Run hold sweeper
            </button>
            <div className="grow">
              <input
                placeholder="booking id from /bookings/…"
                value={holdId}
                onChange={(e) => setHoldId(e.target.value)}
              />
            </div>
            <button
              className="ghost"
              disabled={busy || !holdId}
              onClick={() =>
                run(`force hold to expire: ${holdId.slice(0, 8)}`, async () => {
                  say(`  ${(await call("expire-one", { bookingId: holdId })).message}`);
                })
              }
            >
              Expire this hold
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">3 · Reset</div>
        <div className="card-pad">
          <div className="row">
            <button
              className="ghost"
              disabled={busy}
              onClick={() =>
                run("reset database", async () => {
                  say(`  ${(await call("reset")).message}`);
                })
              }
            >
              Reset and reseed
            </button>
            <span className="small muted">
              TC-101 1/4 · TC-102 3/4 · TC-103 full · TC-104 expired hold
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          Live invariant check
          <span className="spacer" />
          <span className={violations ? "bad-text" : "ok-text"}>
            {violations ? `${violations} VIOLATION` : "all classes OK"}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Class</th>
              <th>Seats taken</th>
              <th>Bookings holding a seat</th>
              <th>Confirmed</th>
              <th>Invariant</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.trial_class_id}>
                <td>{a.trial_class_id}</td>
                <td>
                  {a.seats_taken} / {a.capacity}
                </td>
                <td>{a.seat_holding_bookings}</td>
                <td>{a.confirmed_bookings}</td>
                <td className={a.ok ? "ok-text" : "bad-text"}>
                  {a.ok ? "OK" : "VIOLATED"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="card-pad small muted">
          Checks <code>seats_taken ≤ capacity</code> and{" "}
          <code>seats_taken = bookings holding a seat</code>. If either is ever
          false, this is the bug the whole repo exists to prevent.
        </div>
      </div>

      <h2>Activity log</h2>
      <pre>{log.length ? log.join("\n") : "Run a scenario above to see results here."}</pre>
    </>
  );
}
