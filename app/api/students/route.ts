import { NextResponse } from "next/server";
import { pool } from "../../../src/db/pool.js";
import { errorResponse } from "../../../src/http.js";

export const dynamic = "force-dynamic";

/** Stands in for "the children on the logged-in parent's account". */
export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.level, p.name AS parent_name
         FROM students s JOIN parents p ON p.id = s.parent_id
        ORDER BY s.level, s.name`,
    );
    return NextResponse.json({ students: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
