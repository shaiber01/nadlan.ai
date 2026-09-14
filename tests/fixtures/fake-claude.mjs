#!/usr/bin/env node
// A stand-in for the `claude` CLI used by the monitor tests: checks the flags the session runner must
// pass, then prints a `--output-format json` result. Never calls a model.
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
if (val("--output-format") !== "json") fail("--output-format json missing");
if (val("--permission-prompts") !== "none") fail("--permission-prompts none missing");
if (val("--permission-mode") !== "manual") fail("--permission-mode manual missing");
if (!(val("--allowedTools") ?? "").includes("mcp__bakara__*")) fail("--allowedTools must allow mcp__bakara__*");
if (!(val("--disallowedTools") ?? "").includes("mcp__bakara__reset_project")) fail("--disallowedTools must deny reset_project");
const sessionId = val("--resume") ?? val("--session-id");
if (!sessionId) fail("no --resume or --session-id");
const prompt = args[args.length - 1] ?? "";
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(args)}\n`);

const result = (fields) => {
  process.stdout.write(`${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: sessionId, total_cost_usd: 0.01, duration_ms: 5, num_turns: 1, permission_denials: [], ...fields })}\n`);
};

if (prompt.includes("FAIL")) {
  process.stderr.write("boom\n");
  process.exit(1);
}
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
  result({ result: `echo(${mode}${ctx}): ${prompt}` });
}
