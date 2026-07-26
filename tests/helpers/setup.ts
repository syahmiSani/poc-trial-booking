import { afterAll } from "vitest";
import { pool } from "../../src/db/pool.js";

// Without this the process hangs after the last test holding open sockets.
afterAll(async () => {
  await pool.end();
});
