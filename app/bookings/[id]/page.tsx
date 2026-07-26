import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "../../../src/db/pool.js";
import { getBooking } from "../../../src/domain/bookings.js";
import { PayPanel } from "./pay-panel";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, { title: string; body: string }> = {
  pending_payment: {
    title: "Seat held — payment needed",
    body: "We are holding this seat for you. It is released automatically if payment is not completed in time.",
  },
  confirmed: {
    title: "Booking confirmed",
    body: "Your child is on the class roster. See you in class.",
  },
  payment_failed: {
    title: "Payment did not go through",
    body: "The seat has been released and you have not been charged. You are welcome to try again.",
  },
  cancelled: {
    title: "Seat no longer available",
    body: "This seat was taken before your payment completed, so the payment was cancelled. You have not been charged.",
  },
  expired: {
    title: "Hold expired",
    body: "The seat was released because payment was not completed in time. You have not been charged.",
  },
};

export default async function BookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const booking = await getBooking(id);
  if (!booking) notFound();

  const [{ rows: ctx }, { rows: attempts }] = await Promise.all([
    pool.query(
      `SELECT s.name AS student_name, tc.subject, tc.level, tc.starts_at,
              tc.teacher_name, tc.price_cents
         FROM bookings b
         JOIN students s ON s.id = b.student_id
         JOIN trial_classes tc ON tc.id = b.trial_class_id
        WHERE b.id = $1`,
      [id],
    ),
    pool.query(
      `SELECT status, failure_code, provider_ref, amount_cents
         FROM payment_attempts WHERE booking_id = $1 ORDER BY created_at`,
      [id],
    ),
  ]);

  const c = ctx[0];
  const copy = STATUS_COPY[booking.status];
  const tone =
    booking.status === "confirmed"
      ? "info"
      : booking.status === "pending_payment"
        ? "warn"
        : "danger";

  return (
    <>
      <div className="page-head">
        <h1>Your trial booking</h1>
        <p className="sub">
          Reference {id.slice(0, 8)} ·{" "}
          <span className={`badge ${booking.status}`}>
            {booking.status.replace("_", " ")}
          </span>
        </p>
      </div>

      {copy && (
        <div className={`note ${tone}`} style={{ marginBottom: 16 }}>
          <strong>{copy.title}</strong>
          <div style={{ marginTop: 2 }}>{copy.body}</div>
        </div>
      )}

      <div className="card">
        <div className="card-head">Class details</div>
        <div className="card-pad">
          <dl className="kv">
            <dt>Child</dt>
            <dd>{c?.student_name}</dd>
            <dt>Subject</dt>
            <dd style={{ textTransform: "capitalize" }}>
              {c?.subject} · {c?.level}
            </dd>
            <dt>When</dt>
            <dd>{c && new Date(c.starts_at).toLocaleString("en-SG")}</dd>
            <dt>Teacher</dt>
            <dd>{c?.teacher_name}</dd>
            <dt>Class</dt>
            <dd>{booking.trial_class_id}</dd>
            <dt>Price</dt>
            <dd>S${((c?.price_cents ?? 0) / 100).toFixed(2)}</dd>
            {booking.hold_expires_at && (
              <>
                <dt>Seat held until</dt>
                <dd>
                  {new Date(booking.hold_expires_at).toLocaleTimeString("en-SG")}
                </dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {booking.status === "pending_payment" && (
        <PayPanel bookingId={id} amountCents={c?.price_cents ?? 0} />
      )}

      {attempts.length > 0 && (
        <div className="card">
          <div className="card-head">Payment history</div>
          <table>
            <thead>
              <tr>
                <th>Result</th>
                <th>Reference</th>
                <th>Reason</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a, i) => (
                <tr key={i}>
                  <td style={{ textTransform: "capitalize" }}>{a.status}</td>
                  <td className="muted small">{a.provider_ref ?? "—"}</td>
                  <td className="muted">{a.failure_code ?? "—"}</td>
                  <td>S${(a.amount_cents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 18 }} className="small">
        <Link href={`/roster/${booking.trial_class_id}`}>
          View class roster
        </Link>
        {"   ·   "}
        <Link href="/">Book another trial</Link>
      </p>
    </>
  );
}
