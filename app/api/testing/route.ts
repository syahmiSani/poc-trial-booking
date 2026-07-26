import { NextResponse } from "next/server";
import { pool } from "../../../src/db/pool.js";
import { resetDatabase, seatAudit } from "../../../src/db/sql.js";
import { createBooking } from "../../../src/domain/bookings.js";
import { expireHolds } from "../../../src/jobs/expire-holds.js";
import { isBookingError } from "../../../src/domain/errors.js";

export const dynamic = "force-dynamic";

/**
 * Testing console backend.
 *
 * A race needs two requests OVERLAPPING, not two people. Everything here
 * manufactures that overlap on demand so one person at one laptop can drive
 * every scenario in the brief.
 *
 * This route would not exist in production. It is fenced off behind /testing
 * and does nothing a reviewer cannot verify by reading it.
 */
export async function POST(req: Request) {
  const { action, ...args } = await req.json();

  try {
    switch (action) {
      case "reset":
        await resetDatabase();
        return NextResponse.json({ ok: true, message: "database reset and reseeded" });

      case "audit":
        return NextResponse.json({ ok: true, audit: await seatAudit() });

      case "expire-holds": {
        const { expired } = await expireHolds();
        return NextResponse.json({
          ok: true,
          message: `released ${expired} expired hold(s)`,
          audit: await seatAudit(),
        });
      }

      case "expire-one": {
        // Force a specific booking's hold to lapse, so the seat-lost path can
        // be triggered without waiting ten minutes.
        const { rowCount } = await pool.query(
          `UPDATE bookings SET hold_expires_at = now() - interval '1 second'
            WHERE id = $1 AND status = 'pending_payment'`,
          [args.bookingId],
        );
        return NextResponse.json({
          ok: rowCount === 1,
          message:
            rowCount === 1
              ? "hold forced to expire — the seat is now claimable by someone else"
              : "no pending booking with that id",
        });
      }

      case "race": {
        // THE headline scenario: N parents hitting the same last seat at the
        // same instant. raceWindowMs holds the window open so every request
        // reads the seat count before any of them writes — otherwise the
        // outcome depends on scheduling luck.
        const n: number = args.n ?? 20;
        const strategy: "safe" | "naive" = args.strategy ?? "safe";
        const classId: string = args.trialClassId ?? "TC-102";
        const windowMs: number = args.raceWindowMs ?? 200;

        const { rows: students } = await pool.query<{ id: string; name: string }>(
          `SELECT s.id, s.name FROM students s
             JOIN trial_classes tc ON tc.id = $1
            WHERE s.level = tc.level
              AND s.id NOT IN (
                SELECT student_id FROM bookings
                 WHERE trial_class_id = $1
                   AND status IN ('pending_payment','confirmed'))
            ORDER BY s.id LIMIT $2`,
          [classId, n],
        );

        if (students.length === 0) {
          return NextResponse.json({
            ok: false,
            message: "no eligible children left for this class — reset first",
          });
        }

        const before = await seatAudit();
        const settled = await Promise.allSettled(
          students.map((s) =>
            createBooking(
              { studentId: s.id, trialClassId: classId },
              { strategy, raceWindowMs: windowMs },
            ),
          ),
        );

        const won = settled.filter((r) => r.status === "fulfilled").length;
        const refused = settled.filter(
          (r) => r.status === "rejected" && isBookingError(r.reason),
        ).length;
        const crashed = settled.filter(
          (r) => r.status === "rejected" && !isBookingError(r.reason),
        ).length;

        return NextResponse.json({
          ok: true,
          contenders: students.length,
          strategy,
          won,
          refusedCleanly: refused,
          rawDatabaseErrors: crashed,
          before: before.find((r) => r.trial_class_id === classId),
          after: (await seatAudit()).find((r) => r.trial_class_id === classId),
        });
      }

      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
