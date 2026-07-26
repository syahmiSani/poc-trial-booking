/**
 * Container startup: wait for Postgres, then create the schema and seed it if
 * it is not already there.
 *
 * Plain .mjs rather than TypeScript on purpose. The production image has no
 * tsx and no devDependencies, so anything that runs before the server has to
 * be executable by node as-is.
 *
 * Deliberately NOT destructive. It seeds an empty database and leaves a
 * populated one alone, so restarting the container does not wipe whatever the
 * reviewer was in the middle of. Use the Reset button on /testing for that.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const DB_DIR = process.env.DB_SQL_DIR ?? "/app/db";
const url =
  process.env.DATABASE_URL ??
  "postgres://ottodot:ottodot@db:5432/ottodot";

async function connectWithRetry(attempts = 40) {
  for (let i = 1; i <= attempts; i++) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch (err) {
      await client.end().catch(() => {});
      if (i === attempts) throw err;
      if (i === 1) console.log("waiting for postgres...");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("unreachable");
}

const client = await connectWithRetry();

const { rows } = await client.query(
  "SELECT to_regclass('public.trial_classes') IS NOT NULL AS ready",
);

if (rows[0]?.ready) {
  console.log("database already initialised, leaving it alone");
} else {
  console.log("initialising database...");
  for (const file of [path.join("migrations", "001_schema.sql"), "seed.sql"]) {
    const sql = await readFile(path.join(DB_DIR, file), "utf8");
    await client.query(sql);
    console.log("  applied", file);
  }
  const { rows: audit } = await client.query(
    "SELECT count(*)::int AS n, count(*) FILTER (WHERE NOT ok)::int AS bad FROM class_seat_audit",
  );
  console.log(
    `  ${audit[0].n} classes seeded, ${audit[0].bad} invariant violations`,
  );
  if (audit[0].bad > 0) process.exit(1);
}

await client.end();
