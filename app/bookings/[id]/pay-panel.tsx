"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Card options are visible because this is a test build, a reviewer needs to
 * reach the decline and timeout paths without a real gateway. In production
 * this panel would be the provider's hosted card field.
 */
const CARDS = [
  { token: "tok_ok", label: "Visa •••• 4242, succeeds" },
  { token: "tok_fail_declined", label: "Visa •••• 0002, declined" },
  { token: "tok_fail_funds", label: "Visa •••• 9995, insufficient funds" },
  { token: "tok_timeout", label: "Visa •••• 0000, provider timeout" },
];

export function PayPanel({
  bookingId,
  amountCents,
}: {
  bookingId: string;
  amountCents: number;
}) {
  const router = useRouter();
  const [card, setCard] = useState(CARDS[0]!.token);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function pay() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/bookings/${bookingId}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardToken: card }),
    });
    const json = await res.json();
    setBusy(false);

    setMsg(
      res.ok
        ? { ok: true, text: "Payment successful, your seat is confirmed." }
        : {
            ok: false,
            text:
              // Two different codes mean the same thing to a parent: the seat
              // is gone and no money moved. Only the internals differ, so only
              // the internals should care about the distinction.
              json.error === "SEAT_LOST" || json.error === "NOT_PENDING"
                ? "Sorry, this seat is no longer held for you, so the payment was cancelled. You have not been charged. Please pick another time."
                : json.error === "PROVIDER_TIMEOUT"
                  ? "The payment provider did not respond. Press Pay again, it will not charge you twice."
                  : (json.message ?? json.error),
          },
    );
    router.refresh();
  }

  return (
    <div className="card">
      <div className="card-head">
        Payment
        <span className="spacer" />
        <span className="muted small">Secure checkout</span>
      </div>
      <div className="card-pad">
        <label className="field" htmlFor="card">
          Card
        </label>
        <select id="card" value={card} onChange={(e) => setCard(e.target.value)}>
          {CARDS.map((c) => (
            <option key={c.token} value={c.token}>
              {c.label}
            </option>
          ))}
        </select>

        {msg && (
          <div
            className={`note ${msg.ok ? "info" : "danger"}`}
            style={{ marginTop: 12 }}
          >
            {msg.text}
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={pay} disabled={busy}>
            {busy ? <span className="spin" /> : `Pay S$${(amountCents / 100).toFixed(2)}`}
          </button>
          <span className="small muted">
            You are only charged once the seat is confirmed.
          </span>
        </div>
      </div>
    </div>
  );
}
