import { NextResponse } from "next/server";
import { getRoster } from "../../../../../src/domain/bookings.js";
import { errorResponse } from "../../../../../src/http.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/classes/:id/roster — what the teacher reads before class.
 *
 * Confirmed bookings only. A held seat is not a child in the room, and a failed
 * payment certainly is not.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const roster = await getRoster(id);
    if (!roster) {
      return NextResponse.json({ error: "CLASS_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json(roster);
  } catch (err) {
    return errorResponse(err);
  }
}
