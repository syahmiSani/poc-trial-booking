import { NextResponse } from "next/server";
import { cancelBooking } from "../../../../../src/domain/bookings.js";
import { errorResponse } from "../../../../../src/http.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/bookings/:id/cancel
 *
 * Removes a child from the class and returns the seat to the pool. Used by the
 * roster view. `refundDue` is reported rather than acted on, refunds are out
 * of scope, and quietly swallowing that fact would be worse than saying so.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await cancelBooking(id, body.reason ?? "removed_by_admin");
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
