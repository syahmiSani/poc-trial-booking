import pg from "pg";
import { config } from "../config.js";

/**
 * Single shared pool. The concurrency tests open many clients at once, so the
 * pool is sized above the default 10 — a queued client would serialise the
 * very race the tests are trying to create, and the suite would pass for the
 * wrong reason.
 */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 30,
  idleTimeoutMillis: 5_000,
});

export type Db = pg.PoolClient;

/**
 * Runs `fn` inside a transaction, rolling back on any throw.
 *
 * Every seat mutation in this codebase goes through here. Nothing outside a
 * transaction is allowed to touch `seats_taken`, because the guarantee is that
 * the seat write and the booking write commit together or not at all.
 */
export async function withTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      /* connection already broken; the original error is the useful one */
    });
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres error codes we translate into domain errors rather than 500s. */
export const PG = {
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",
} as const;

export function isPgError(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}
