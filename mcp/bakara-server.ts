import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tools } from "../src/hadarim/tools";

/**
 * בקרה — the budget-control tools as an MCP server over stdio. Registered in `.mcp.json`
 * (`npx vite-node mcp/bakara-server.ts`), so a Claude Code session in this folder — and the `bakara`
 * agent in particular — sees them as `mcp__bakara__<tool>`.
 *
 * stdout is the protocol channel: everything a dependency might print goes to stderr.
 */

// eslint-disable-next-line no-console
console.log = (...args: unknown[]) => console.error(...args);
console.info = console.log;
console.debug = console.log;

const server = new McpServer(
  { name: "bakara", version: "0.1.0" },
  {
    instructions:
      "Budget-control tools over the projects database. Reads (list_/get_/query_/search_) never write. run_check computes without saving; run_control opens the control session. decide_finding / route_finding / confirm_quote act on findings; reallocate_invoice, correct_purchase_order, set_invoice_building, create_invoice write ERP rows attributed to byId and re-read them. add_forecast_adjustment, open_task, set_task_status, add_control_note, set_project_status, set_report_config shape the control and its report; build_report renders it; finalize_control closes it. raise_finding / record_review_pass are the agent's own reading; add_document / classify_document / set_document_facts process documents (a document with no facts_source is unprocessed); get_heartbeat_work / record_heartbeat are the pass over everything new since the last one; list_budget_changes / add_budget_change are the approved budget changes (the budget is not the forecast). reset_project is destructive. All amounts are whole shekels before VAT; every write needs the user's decision.",
  },
);

for (const t of tools) {
  server.registerTool(
    t.name,
    {
      title: t.title,
      description: t.description,
      inputSchema: t.input,
      annotations: { readOnlyHint: t.kind === "read" || t.kind === "check", destructiveHint: t.kind === "destructive", idempotentHint: t.kind === "read" || t.kind === "check", openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await t.run(args as never);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 1) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `✗ ${e instanceof Error ? e.message : String(e)}` }] };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
console.error(`bakara MCP server ready — ${tools.length} tools`);
