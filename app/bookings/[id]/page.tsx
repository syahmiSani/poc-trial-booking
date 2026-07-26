"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";

const CARDS = [
  { token: "tok_ok", label: "Working card" },
  { token: "tok_fail_declined", label: "Declined card" },
  { token: "tok_fail_funds", label: "Insufficient funds" },
  { token: "tok_timeout", label: "Provider timeout (charge lands, reply lost)" },
];

export default function BookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<any>(null);
  const [card, setCard] = useState(CARDS[0]!.token);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setData(await fetch(`/api/bookings/${id}`).then((r) => r.json()));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pay() {
    setBusy(true);
    setResult(null);
    const res = await fetch(`/api/bookings/${id}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardToken: card }),
    });
    const json = await res.json();
    setBusy(false);
    setResult(
      res.ok
        ? { ok: true, text: "Payment captured. The seat is confirmed." }
        : { ok: false, text: `${json.error} — ${json.message ?? ""}` },
    );
    await load();
  }

  if (!data?.booking) return <p>Loading…</p>;
  const b = data.booking;
  const ctx = data.context;
  const pending = b.status === "pending_payment";

  return (
    <>
      <h1>Booking {b.id.slice(0, 8)}</h1>
      <p className="hint">
        <span className={`pill ${b.status}`}>{b.status}</span>
      </p>

      <div className="card">
        <table>
          <tbody>
            <tr><th>Child</th><td>{ctx?.student_name}</td></tr>
            <tr><th>Class</th><td>{b.trial_class_id} — {ctx?.subject} {ctx?.level}</td></tr>
            <tr><th>Starts</th><td>{ctx && new Date(ctx.starts_at).toLocaleString()}</td></tr>
            <tr><th>Teacher</th><td>{ctx?.teacher_name}</td></tr>
            <tr><th>Price</th><td>S${((ctx?.price_cents ?? 0) / 100).toFixed(2)}</td></tr>
            <tr>
              <th>Seat held until</th>
              <td>
                {b.hold_expires_at
                  ? new Date(b.hold_expires_at).toLocaleTimeString()
                  : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {pending && (
        <>
          <h2>Payment</h2>
          <div className="card">
            <p className="hint">
              The seat is already held for you. Money is only captured after the
              booking is confirmed — if the seat is gone by then, the
              authorization is voided and you are not charged.
            </p>
            <div className="row">
              <select value={card} onChange={(e) => setCard(e.target.value)}>
                {CARDS.map((c) => (
                  <option key={c.token} value={c.token}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button onClick={pay} disabled={busy}>
                {busy ? "Processing…" : "Pay S$50.00"}
              </button>
            </div>
          </div>
        </>
      )}

      {result && (
        <div className="card" style={{ borderColor: result.ok ? "#9ccdae" : "#e5a9a3" }}>
          <strong className={result.ok ? "ok" : "bad"}>{result.text}</strong>
        </div>
      )}

      <h2>Payment attempts</h2>
      <div className="card">
        {data.attempts.length === 0 ? (
          <p className="hint">None yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Status</th><th>Provider ref</th><th>Failure</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {data.attempts.map((a: any, i: number) => (
                <tr key={i}>
                  <td>{a.status}</td>
                  <td>{a.provider_ref ?? "—"}</td>
                  <td>{a.failure_code ?? "—"}</td>
                  <td>S${(a.amount_cents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p>
        <Link href={`/roster/${b.trial_class_id}`}>
          View the roster for {b.trial_class_id}
        </Link>
        {"  ·  "}
        <Link href="/">Book another</Link>
      </p>
    </>
  );
}
