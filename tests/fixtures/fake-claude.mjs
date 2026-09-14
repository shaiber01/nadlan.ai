#!/usr/bin/env node
// A stand-in for the `claude` CLI used by the monitor tests: checks the flags the session runner must
// pass, then prints the `--output-format stream-json` events a real turn produces (init, a tool call, its
// result, the reply, the result object). Never calls a model.
//   prompt containing FAIL  → exit 1 with stderr
//   prompt containing LOGIN → an is_error result saying the login expired
//   prompt containing SLOW  → waits 5 s (the runner's timeout test), exits on SIGINT
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (msg) => {
  process.stderr.write(`fake-claude: ${msg}\n`);
  process.exit(2);
};

if (process.env.ANTHROPIC_API_KEY) fail("ANTHROPIC_API_KEY must not be set");
if (has("--bare")) fail("--bare must not be passed");
if (!has("-p")) fail("-p missing");
if (val("--output-format") !== "stream-json") fail("--output-format stream-json missing");
if (!has("--verbose")) fail("--verbose missing (stream-json needs it)");
if (val("--permission-prompts") !== "none") fail("--permission-prompts none missing");
if (val("--permission-mode") !== "manual") fail("--permission-mode manual missing");
if (!(val("--allowedTools") ?? "").includes("mcp__bakara__*")) fail("--allowedTools must allow mcp__bakara__*");
if (!(val("--disallowedTools") ?? "").includes("mcp__bakara__reset_project")) fail("--disallowedTools must deny reset_project");
const sessionId = val("--resume") ?? val("--session-id");
if (!sessionId) fail("no --resume or --session-id");
const prompt = args[args.length - 1] ?? "";
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(args)}\n`);

const model = val("--model") ? `claude-${val("--model")}-fake` : "claude-fake";
const emit = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const result = (fields) => emit({ type: "result", subtype: "success", is_error: false, session_id: sessionId, total_cost_usd: 0.01, duration_ms: 5, num_turns: 1, permission_denials: [], modelUsage: { [model]: { costUSD: 0.01 } }, ...fields });

if (prompt.includes("FAIL")) {
  process.stderr.write("boom\n");
  process.exit(1);
}
emit({ type: "system", subtype: "init", session_id: sessionId, model, mcp_servers: [{ name: "bakara", status: "connected" }] });
if (prompt.includes("LOGIN")) {
  result({ is_error: true, subtype: "error_during_execution", result: "Login expired · Please run /login" });
  process.exit(0);
}
if (prompt.includes("SLOW")) {
  process.on("SIGINT", () => process.exit(130));
  setTimeout(() => result({ result: "too late" }), 5000);
} else {
  const mode = has("--resume") ? "resumed" : "new";
  const ctx = val("--append-system-prompt") ? ",ctx" : "";
  const text = `echo(${mode}${ctx}): ${prompt}`;
  emit({ type: "assistant", message: { model, content: [{ type: "tool_use", id: "toolu_1", name: "get_project", input: { projectId: "HADARIM" } }] } });
  emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: JSON.stringify({ project: { id: "HADARIM", nameHe: "הדרים" } }) }] } });
  emit({ type: "assistant", message: { model, content: [{ type: "text", text }] } });
  result({ result: text });
}
