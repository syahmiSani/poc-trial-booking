import { NextResponse } from "next/server";
import { pool } from "../../../src/db/pool.js";
import { seatAudit } from "../../../src/db/sql.js";
import {
  resetAll,
  scenarioDeclined,
  scenarioDoubleBook,
  scenarioRace,
  scenarioSeatLost,
} from "../../../src/testing/scenarios.js";
import { expireHolds } from "../../../src/jobs/expire-holds.js";

export const dynamic = "force-dynamic";

/**
 * Testing console backend.
 *
 * A race needs two requests OVERLAPPING, not two people. Everything here
 * manufactures that overlap on demand so one person at one laptop can drive
 * every scenario in the brief. This route would not ship to production.
 */
export async function POST(req: Request) {
  const { action, ...args } = await req.json();

  try {
    switch (action) {
      case "reset":
        await resetAll();
        return NextResponse.json({ ok: true, message: "Data reset to the starting fixtures" });

      case "audit":
        return NextResponse.json({ ok: true, audit: await seatAudit() });

      case "expire-holds": {
        const { expired } = await expireHolds();
        return NextResponse.json({
          ok: true,
          message: `Released ${expired} expired hold${expired === 1 ? "" : "s"}`,
        });
      }

      case "expire-one": {
        const { rowCount } = await pool.query(
          `UPDATE bookings SET hold_expires_at = now() - interval '1 second'
            WHERE id = $1 AND status = 'pending_payment'`,
          [args.bookingId],
        );
        return NextResponse.json({
          ok: rowCount === 1,
          message:
            rowCount === 1
              ? "Hold forced to expire, the seat is claimable again"
              : "No pending booking with that id",
        });
      }

      // -- narrated scenarios ------------------------------------------------
      case "scenario:double-book":
        return NextResponse.json({ ok: true, result: await scenarioDoubleBook() });
      case "scenario:race":
        return NextResponse.json({
          ok: true,
          result: await scenarioRace({ n: args.n ?? 20, strategy: args.strategy ?? "safe" }),
        });
      case "scenario:declined":
        return NextResponse.json({ ok: true, result: await scenarioDeclined() });
      case "scenario:seat-lost":
        return NextResponse.json({ ok: true, result: await scenarioSeatLost() });

      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
