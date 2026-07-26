import { NextResponse } from "next/server";
import { mockProvider } from "../../../../src/payments/mock.js";

export const dynamic = "force-dynamic";

/** POST /api/mock-provider/capture, money actually moves here, and only here. */
export async function POST(req: Request) {
  const { authId, idempotencyKey } = await req.json();
  try {
    return NextResponse.json(await mockProvider.capture(authId, idempotencyKey));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 422 });
  }
}
