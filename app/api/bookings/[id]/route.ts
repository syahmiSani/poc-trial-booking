import { NextResponse } from "next/server";
import { getBooking } from "../../../../src/domain/bookings.js";
import { pool } from "../../../../src/db/pool.js";
import { errorResponse } from "../../../../src/http.js";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const booking = await getBooking(id);
    if (!booking) {
      return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
    }

    const { rows: attempts } = await pool.query(
      `SELECT status, failure_code, provider_ref, amount_cents, created_at
         FROM payment_attempts WHERE booking_id = $1 ORDER BY created_at`,
      [id],
    );
    const { rows: ctx } = await pool.query(
      `SELECT s.name AS student_name, tc.subject, tc.level, tc.starts_at,
              tc.teacher_name, tc.price_cents
         FROM bookings b
         JOIN students s ON s.id = b.student_id
         JOIN trial_classes tc ON tc.id = b.trial_class_id
        WHERE b.id = $1`,
      [id],
    );

    return NextResponse.json({ booking, context: ctx[0] ?? null, attempts });
  } catch (err) {
    return errorResponse(err);
  }
}
