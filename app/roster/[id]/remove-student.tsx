"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RemoveStudent({
  bookingId,
  studentName,
}: {
  bookingId: string;
  studentName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "removed_by_admin" }),
    });
    const json = await res.json();
    setBusy(false);

    if (!res.ok) {
      setError(json.message ?? json.error);
      return;
    }
    setConfirming(false);
    // The seat is back in the pool, re-render the roster from the server.
    router.refresh();
  }

  if (error) {
    return (
      <span className="small bad-text" title={error}>
        {error}
      </span>
    );
  }

  if (!confirming) {
    return (
      <button className="ghost sm" onClick={() => setConfirming(true)}>
        Remove
      </button>
    );
  }

  return (
    <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <span className="small muted">Remove {studentName}?</span>
      <button className="danger sm" onClick={remove} disabled={busy}>
        {busy ? <span className="spin" /> : "Yes"}
      </button>
      <button className="ghost sm" onClick={() => setConfirming(false)} disabled={busy}>
        No
      </button>
    </span>
  );
}
