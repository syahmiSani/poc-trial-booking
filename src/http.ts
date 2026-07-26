import { NextResponse } from "next/server";
import { isBookingError } from "./domain/errors.js";

/**
 * Maps domain refusals to HTTP.
 *
 * The distinction this preserves: CLASS_FULL and DUPLICATE_BOOKING are the
 * system working correctly and get a 4xx with a code the UI can act on.
 * Anything else is a genuine bug and gets a 500 — never dressed up as a
 * business outcome, because a 500 is something we should be paged about.
 */
export function errorResponse(err: unknown): NextResponse {
  if (isBookingError(err)) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: err.httpStatus },
    );
  }
  console.error("unhandled error", err);
  return NextResponse.json(
    { error: "INTERNAL", message: "something went wrong" },
    { status: 500 },
  );
}
