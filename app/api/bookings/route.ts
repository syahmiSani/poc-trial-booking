import { NextResponse } from "next/server";
import { createBooking } from "../../../src/domain/bookings.js";
import { errorResponse } from "../../../src/http.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/bookings — reserve a seat and open a checkout window.
 *
 * `strategy` and `raceWindowMs` are accepted so the in-app testing console can
 * drive the naive implementation and widen the race window on demand. They are
 * test affordances, not product features, and are documented as such.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const booking = await createBooking(
      { studentId: body.studentId, trialClassId: body.trialClassId },
      {
        strategy: body.strategy,
        raceWindowMs: body.raceWindowMs,
      },
    );
    return NextResponse.json({ booking }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
