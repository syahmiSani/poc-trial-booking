import { withTransaction } from "../db/pool.js";

/**
 * Release seats whose checkout window has closed.
 *
 * This is repair, never the primary guarantee. Nothing in the system depends on
 * it running on time — a late sweep delays availability, it never permits an
 * overbooking. That separation is deliberate: a background job that the
 * invariants depended on would be a background job that could break them.
 *
 * One statement, one transaction. Expiring the bookings and returning their
 * seats cannot be interleaved, so the counter can never reflect a half-done
 * sweep. Safe to run repeatedly and safe to run concurrently with checkout.
 */
export async function expireHolds(): Promise<{ expired: number }> {
  return withTransaction(async (db) => {
    const { rows } = await db.query<{ trial_class_id: string; n: number }>(
      `WITH expired AS (
         UPDATE bookings
            SET status = 'expired', hold_expires_at = NULL
          WHERE status = 'pending_payment'
            AND hold_expires_at < now()
          RETURNING trial_class_id
       ),
       per_class AS (
         SELECT trial_class_id, count(*)::int AS n
           FROM expired GROUP BY trial_class_id
       )
       UPDATE trial_classes tc
          SET seats_taken = tc.seats_taken - pc.n
         FROM per_class pc
        WHERE tc.id = pc.trial_class_id
          AND tc.seats_taken >= pc.n
       RETURNING tc.id AS trial_class_id, pc.n`,
      [],
    );

    return { expired: rows.reduce((sum, r) => sum + r.n, 0) };
  });
}
