export type BookingErrorCode =
  | "CLASS_NOT_FOUND"
  | "STUDENT_NOT_FOUND"
  | "LEVEL_MISMATCH"
  | "DUPLICATE_BOOKING"
  | "CLASS_FULL"
  | "BOOKING_NOT_FOUND"
  | "SEAT_LOST"
  | "PAYMENT_FAILED"
  | "NOT_PENDING";

const HTTP_STATUS: Record<BookingErrorCode, number> = {
  CLASS_NOT_FOUND: 404,
  STUDENT_NOT_FOUND: 404,
  BOOKING_NOT_FOUND: 404,
  LEVEL_MISMATCH: 422,
  DUPLICATE_BOOKING: 409,
  CLASS_FULL: 409,
  SEAT_LOST: 409,
  NOT_PENDING: 409,
  PAYMENT_FAILED: 402,
};

/**
 * An expected, meaningful refusal — not a crash.
 *
 * The distinction matters: CLASS_FULL is the system working correctly and must
 * never surface as a 500, because "the class filled up" is a thing we tell a
 * parent, while a genuine bug is a thing we page someone about.
 */
export class BookingError extends Error {
  constructor(
    readonly code: BookingErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "BookingError";
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

export function isBookingError(err: unknown): err is BookingError {
  return err instanceof BookingError;
}
