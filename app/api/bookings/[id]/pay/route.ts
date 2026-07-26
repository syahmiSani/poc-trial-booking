import { NextResponse } from "next/server";
import { payBooking } from "../../../../../src/domain/payments.js";
import { HttpPaymentProvider } from "../../../../../src/payments/http.js";
import { ProviderTimeout } from "../../../../../src/payments/provider.js";
import { errorResponse } from "../../../../../src/http.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/bookings/:id/pay
 *
 * Goes to the provider over REST so the network boundary is real. The
 * idempotency key defaults to the booking id, which makes a double-clicked
 * Pay button idempotent for free.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const origin = new URL(req.url).origin;
    const provider = new HttpPaymentProvider(`${origin}/api/mock-provider`);

    const booking = await payBooking(
      {
        bookingId: id,
        cardToken: body.cardToken ?? "tok_ok",
        idempotencyKey: body.idempotencyKey ?? `booking-${id}`,
      },
      { provider },
    );
    return NextResponse.json({ booking });
  } catch (err) {
    if (err instanceof ProviderTimeout) {
      return NextResponse.json(
        {
          error: "PROVIDER_TIMEOUT",
          message:
            "the provider did not answer. Retry with the same idempotency key — it will not double charge.",
        },
        { status: 504 },
      );
    }
    return errorResponse(err);
  }
}
