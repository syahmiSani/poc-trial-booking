"use client";

import { useState } from "react";

type Step = {
  actor: string;
  text: string;
  detail?: string;
  status: "ok" | "blocked" | "error" | "info";
};
type SeatState = { capacity: number; confirmed: number; held: number; free: number };
type ManualStep = { do: string; see: string; where?: string };
type Result = {
  id: string;
  title: string;
  question: string;
  expectation: string;
  before: SeatState;
  after: SeatState;
  steps: Step[];
  pass: boolean;
  headline: string;
  detail: string;
  manual: { intro: string; steps: ManualStep[]; caveat?: string };
};
type Audit = {
  trial_class_id: string;
  capacity: number;
  seats_taken: number;
  seat_holding_bookings: number;
  confirmed_bookings: number;
  ok: boolean;
};

const FIXTURES = ["TC-101", "TC-102", "TC-103", "TC-104"];

async function call(action: string, args: Record<string, unknown> = {}) {
  const res = await fetch("/api/testing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...args }),
  });
  return res.json();
}

/** Four boxes: filled = confirmed, striped = held for checkout, empty = free. */
function Seats({ s }: { s: SeatState }) {
  const cells = [];
  for (let i = 0; i < s.capacity; i++) {
    const kind = i < s.confirmed ? "taken" : i < s.confirmed + s.held ? "held" : "free";
    cells.push(<span key={i} className={`seatbox ${kind}`} />);
  }
  return (
    <span className="seatrow">
      {cells}
      <span className="small muted" style={{ marginLeft: 6 }}>
        {s.confirmed} confirmed{s.held ? ` · ${s.held} held` : ""} · {s.free} free
      </span>
    </span>
  );
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i} className={`step ${s.status}`}>
          <span className="step-actor">{s.actor}</span>
          <span className="step-body">
            <span className="step-text">{s.text}</span>
            {s.detail && <span className="step-detail">{s.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ResultPanel({ r }: { r: Result }) {
  return (
    <div className="result">
      <div className={`verdict ${r.pass ? "pass" : "fail"}`}>
        <strong>{r.pass ? "✓" : "✕"} {r.headline}</strong>
        <div className="small" style={{ marginTop: 3, opacity: 0.9 }}>{r.detail}</div>
      </div>

      <div className="beforeafter">
        <div>
          <div className="ba-label">Before</div>
          <Seats s={r.before} />
        </div>
        <div className="ba-arrow">→</div>
        <div>
          <div className="ba-label">After</div>
          <Seats s={r.after} />
        </div>
      </div>

      <div className="ba-label" style={{ marginTop: 14 }}>What actually happened</div>
      <StepList steps={r.steps} />

      <ManualGuide r={r} />
    </div>
  );
}

/**
 * The console can only tell you what it says happened. This section tells you
 * how to go and check that against the real booking pages yourself.
 */
function ManualGuide({ r }: { r: Result }) {
  const [open, setOpen] = useState(false);
  if (!r.manual?.steps?.length) return null;

  return (
    <div className="manual">
      <button
        className="manual-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="manual-icon" aria-hidden>
          {open ? "−" : "+"}
        </span>
        <span className="manual-toggle-text">
          <span className="manual-toggle-title">
            Verify this yourself in the real app
          </span>
          <span className="manual-toggle-sub">
            {open
              ? "Step by step, using the normal booking pages instead of this console"
              : `${r.manual.steps.length} steps, no console needed`}
          </span>
        </span>
        <span className={`manual-chev${open ? " open" : ""}`} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="manual-body">
          <p className="small muted" style={{ marginTop: 0 }}>{r.manual.intro}</p>
          <ol className="manual-steps">
            {r.manual.steps.map((m, i) => (
              <li key={i}>
                <div className="manual-do">
                  <span className="manual-n">{i + 1}</span>
                  <span>{m.do}</span>
                </div>
                <div className="manual-see">
                  <span className="manual-see-tag">You should see</span>
                  {m.see}
                </div>
                {m.where && <div className="manual-where">{m.where}</div>}
              </li>
            ))}
          </ol>
          {r.manual.caveat && (
            <div className="note warn small" style={{ marginTop: 10 }}>
              {r.manual.caveat}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TestingConsole({ initialAudit }: { initialAudit: Audit[] }) {
  const [audit, setAudit] = useState<Audit[]>(initialAudit);
  const [showAll, setShowAll] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState("");
  const [holdId, setHoldId] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  async function refreshAudit() {
    setAudit((await call("audit")).audit ?? []);
  }

  async function runScenario(key: string, action: string, args = {}) {
    setBusy(key);
    setToast(null);
    const j = await call(action, args);
    if (j.result) setResults((r) => ({ ...r, [key]: j.result }));
    await refreshAudit();
    setBusy("");
  }

  async function util(key: string, action: string, args = {}) {
    setBusy(key);
    const j = await call(action, args);
    setToast(j.message ?? "Done");
    await refreshAudit();
    setBusy("");
  }

  const rows = showAll ? audit : audit.filter((a) => FIXTURES.includes(a.trial_class_id));
  const violations = audit.filter((a) => !a.ok);

  const scenarios: Array<{
    key: string;
    action: string;
    args?: Record<string, unknown>;
    label: string;
    blurb: string;
    variant?: string;
  }> = [
    {
      key: "double-book",
      action: "scenario:double-book",
      label: "Book the same child twice",
      blurb:
        "A parent double-clicks, or opens a stale tab, and books the same child into the same class again.",
    },
    {
      key: "race-safe",
      action: "scenario:race",
      args: { n: 20, strategy: "safe" },
      label: "20 parents, 1 seat",
      blurb:
        "Twenty parents click Book on the last remaining seat at the same instant.",
    },
    {
      key: "race-naive",
      action: "scenario:race",
      args: { n: 20, strategy: "naive" },
      label: "The same race, written badly",
      blurb:
        "Identical test against count-then-write, the mistake this design exists to avoid.",
      variant: "ghost",
    },
    {
      key: "declined",
      action: "scenario:declined",
      label: "Card declined",
      blurb: "A parent holds the seat, then their card is declined.",
    },
    {
      key: "seat-lost",
      action: "scenario:seat-lost",
      label: "Seat lost while paying",
      blurb:
        "The hold expires while the parent is on the payment page, and then they pay.",
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Testing console</h1>
        <p className="sub">
          A race needs two requests <strong>overlapping</strong>, not two people.
          Each scenario below runs the real booking code against the real
          database and shows you every step it took. Data is restored to the
          starting fixtures before every run, so results are repeatable and you
          can run them in any order.
        </p>
      </div>

      {scenarios.map((s) => {
        const r = results[s.key];
        return (
          <div className="card scenario" key={s.key}>
            <div className="card-pad">
              <div className="row" style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <div className="scenario-title">{s.label}</div>
                  <div className="small muted" style={{ marginTop: 2 }}>{s.blurb}</div>
                </div>
                <button
                  className="ghost sm"
                  disabled={!!busy}
                  title="Clear this result and restore the starting data"
                  onClick={() => {
                    setResults((all) => {
                      const next = { ...all };
                      delete next[s.key];
                      return next;
                    });
                    void util(`reset-${s.key}`, "reset");
                  }}
                >
                  Reset
                </button>
                <button
                  className={s.variant === "ghost" ? "ghost" : undefined}
                  disabled={!!busy}
                  onClick={() => runScenario(s.key, s.action, s.args)}
                >
                  {busy === s.key ? <span className="spin" /> : r ? "Run again" : "Run"}
                </button>
              </div>

              {r && (
                <>
                  <div className="qa">
                    <div>
                      <span className="qa-tag">Question</span> {r.question}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <span className="qa-tag">Should happen</span> {r.expectation}
                    </div>
                  </div>
                  <ResultPanel r={r} />
                </>
              )}
            </div>
          </div>
        );
      })}

      <h2>Utilities</h2>
      <div className="card">
        <div className="card-pad">
          <div className="row">
            <button className="ghost" disabled={!!busy} onClick={() => util("reset", "reset")}>
              Reset data
            </button>
            <button
              className="ghost"
              disabled={!!busy}
              onClick={() => util("sweep", "expire-holds")}
            >
              Run hold sweeper
            </button>
            <div className="grow">
              <input
                placeholder="booking id, force its hold to expire"
                value={holdId}
                onChange={(e) => setHoldId(e.target.value)}
              />
            </div>
            <button
              className="ghost"
              disabled={!!busy || !holdId}
              onClick={() => util("expire1", "expire-one", { bookingId: holdId })}
            >
              Expire hold
            </button>
          </div>
          {toast && <div className="note info" style={{ marginTop: 12 }}>{toast}</div>}
        </div>
      </div>

      <h2>Live invariant check</h2>
      <div className="card">
        <div className="card-head">
          {showAll ? "All classes" : "Fixture classes"}
          <span className="spacer" />
          <span className={violations.length ? "bad-text" : "ok-text"}>
            {violations.length ? `${violations.length} VIOLATION` : "all OK"}
          </span>
          <button className="ghost sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fixtures only" : `Show all ${audit.length}`}
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Class</th>
              <th>Seats</th>
              <th>Confirmed</th>
              <th>Invariant</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.trial_class_id}>
                <td>{a.trial_class_id}</td>
                <td>
                  <Seats
                    s={{
                      capacity: a.capacity,
                      confirmed: a.confirmed_bookings,
                      held: a.seat_holding_bookings - a.confirmed_bookings,
                      free: a.capacity - a.seat_holding_bookings,
                    }}
                  />
                </td>
                <td>{a.confirmed_bookings} of {a.capacity}</td>
                <td className={a.ok ? "ok-text" : "bad-text"}>{a.ok ? "OK" : "VIOLATED"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="card-pad small muted">
          Checks <code>seats_taken ≤ capacity</code> and{" "}
          <code>seats_taken = bookings holding a seat</code> for every class. If
          either is ever false, that is the bug this whole system exists to
          prevent.
        </div>
      </div>
    </>
  );
}
