import { callTool } from "../../src/hadarim/tools";

/**
 * Scenes 2–8 of hadarimdemoscript.md through the agent's tools — the same registry the MCP server
 * exposes — against the live database. Used by the opt-in browser test to give the report viewer a
 * finished control to show:  npx vite-node e2e/fixtures/run-demo-control.ts
 * Assumes scene 1 happened (invoice 1147 moved to 02) and the control is idle.
 */
async function main() {
  const run = (await callTool("run_control", { operatorId: "EYAL" })) as { ok: boolean; summaryHe?: string; reason?: string };
  if (!run.ok) throw new Error(`run_control: ${run.reason}`);
  await callTool("decide_finding", { findingId: "allocation", choiceId: "yes_target" });
  await callTool("route_finding", { findingId: "allocation", routeId: "update" });
  await callTool("decide_finding", { findingId: "unit", choiceId: "yes_tons" });
  await callTool("route_finding", { findingId: "unit", routeId: "refer_roi" });
  await callTool("decide_finding", { findingId: "price", choiceId: "all" });
  await callTool("decide_finding", { findingId: "coverage", freeTextHe: "צריך להזמין. יש הצעה בתיקייה" });
  await callTool("confirm_quote", { findingId: "coverage", accept: true });
  await callTool("set_report_config", { includeTrends: true, splitByBuilding: true, ceoVersion: true, save: true });
  const report = (await callTool("build_report", { format: "summary", label: "בקרה 09/2026 — e2e", saveVersion: true })) as { versionId: number | null; summary: { executive: { paragraphHe: string } } };
  console.log(JSON.stringify({ summaryHe: run.summaryHe, versionId: report.versionId, paragraphHe: report.summary.executive.paragraphHe }));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
