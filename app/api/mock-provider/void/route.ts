import { NextResponse } from "next/server";
import { mockProvider } from "../../../../src/payments/mock.js";

export const dynamic = "force-dynamic";

/** POST /api/mock-provider/void, release a hold without charging anyone. */
export async function POST(req: Request) {
  const { authId } = await req.json();
  try {
    await mockProvider.voidAuth(authId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 422 });
  }
}
