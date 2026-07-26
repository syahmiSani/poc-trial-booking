import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DB_DIR = path.resolve(here, "../../db");

async function runFile(file: string): Promise<void> {
  const sql = await readFile(path.join(DB_DIR, file), "utf8");
  await pool.query(sql);
}

/**
 * Drop, recreate, seed. Used by `npm run db:reset` and by every test file.
 *
 * Deliberately destructive and deliberately fast: a test suite that inherits
 * state from the previous run can pass while the code is broken, which is the
 * one failure mode this repo cannot afford.
 */
export async function resetDatabase(): Promise<void> {
  await runFile("reset.sql");
  await runFile(path.join("migrations", "001_schema.sql"));
  await runFile("seed.sql");
}

export type SeatAudit = {
  trial_class_id: string;
  capacity: number;
  seats_taken: number;
  seat_holding_bookings: number;
  confirmed_bookings: number;
  ok: boolean;
};

export async function seatAudit(): Promise<SeatAudit[]> {
  const { rows } = await pool.query<SeatAudit>(
    "SELECT * FROM class_seat_audit ORDER BY trial_class_id",
  );
  return rows;
}
