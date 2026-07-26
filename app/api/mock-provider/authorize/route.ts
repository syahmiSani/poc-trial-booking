import { NextResponse } from "next/server";
import { mockProvider } from "../../../../src/payments/mock.js";
import { ProviderTimeout } from "../../../../src/payments/provider.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/mock-provider/authorize
 *
 * Stands in for the PSP. Holds the funds; does NOT take them.
 */
export async function POST(req: Request) {
  const body = await req.json();
  try {
    return NextResponse.json(await mockProvider.authorize(body));
  } catch (err) {
    if (err instanceof ProviderTimeout) {
      // The authorization DID happen, this response is simply lost. Retrying
      // with the same idempotency key must return the original, not a new one.
      return NextResponse.json({ error: "PROVIDER_TIMEOUT" }, { status: 504 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
