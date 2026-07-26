import { seatAudit } from "../../src/db/sql.js";
import { TestingConsole } from "./console";

export const dynamic = "force-dynamic";

export default async function TestingPage() {
  // Rendered on the server so the audit table is present in the first response
  // rather than appearing a beat later.
  const audit = await seatAudit();
  return <TestingConsole initialAudit={audit} />;
}
