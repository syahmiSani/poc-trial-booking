import { NextResponse } from "next/server";
import { listAvailableClasses } from "../../../src/domain/bookings.js";
import { errorResponse } from "../../../src/http.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // seats_available is ADVISORY — good enough to grey out a full class in the
    // UI, never trusted to decide whether a booking succeeds.
    return NextResponse.json({ classes: await listAvailableClasses() });
  } catch (err) {
    return errorResponse(err);
  }
}
