import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { TraceEvent, TurnTrace } from "./trace";

/**
 * One turn of the bakara agent, headless (docs/heartbeat-bot-plan.md §7.2 and §7.6): `claude -p --agent
 * bakara`, resumed by session id, under the machine's Claude login. The same agent, skills, tools and
 * `.mcp.json` as the terminal; `AskUserQuestion` is removed by `--permission-prompts none`, so the agent
 * asks with numbered options (its own fallback rule); tools are pre-approved by an allow-list and the
 * destructive, shell and SQL tools are denied.
 *
 * Never `--bare` (it skips the login, the agent and the MCP servers) and never with `ANTHROPIC_API_KEY`
 * in the environment (print mode would use it and bill the API instead of the subscription).
 */

export const DEFAULT_ALLOWED_TOOLS = ["mcp__bakara__*", "Read", "Skill"];
export const DEFAULT_DISALLOWED_TOOLS = ["mcp__bakara__reset_project", "mcp__supabase__execute_sql", "mcp__supabase__list_tables", "Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Agent"];
export const DEFAULT_AGENT = "bakara";
export const DEFAULT_TURN_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_MAX_BUDGET_USD = 3;
/** Headless turns answer chat and run passes; a fast model at low effort is the default, the agent file's model the fallback. */
export const DEFAULT_MODEL = "sonnet";
export const DEFAULT_EFFORT = "low";
export const DEFAULT_TRACE_FILE = "out/monitor-trace.log";

export interface RunnerOptions {
  /** The CLI to spawn (default `claude`; a stub in tests). */
  bin?: string;
  agent?: string;
  cwd?: string;
  /** `--model`; undefined leaves the agent file's model. */
  model?: string;
  /** `--effort` (low … max); undefined leaves the settings' default. */
  effort?: string;
  maxBudgetUsd?: number | null;
  timeoutMs?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  env?: NodeJS.ProcessEnv;
  /** Receives every stream event (a trace, a test). */
  onEvent?: (e: TraceEvent) => void;
  /** The turn's trace (the file `npm run monitor -- tail` follows). */
  trace?: TurnTrace;
}

export interface TurnInput {
  /** Resume this session; null starts a new one. */
  sessionId: string | null;
  text: string;
  /** Appended to the system prompt on a new session only (Claude Code snapshots it for the conversation). */
  systemContext?: string;
  /** The id a new session gets (default: a fresh UUID). */
  newSessionId?: string;
}

export interface TurnResult {
  ok: boolean;
  sessionId: string;
  /** The agent's reply, or the failure as Claude Code reported it. */
  text: string;
  costUsd: number | null;
  durationMs: number;
  numTurns: number | null;
  /** The subscription login expired: nothing will run until someone logs in again on the machine. */
  authExpired: boolean;
  error?: string;
  /** Tools the agent asked for and was denied. */
  denials: string[];
}

export class ApiKeyInEnvironmentError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is set: the monitor runs under the machine's Claude login and refuses to bill the API. Unset it (or set MONITOR_ALLOW_API_KEY=1 on purpose).");
    this.name = "ApiKeyInEnvironmentError";
  }
}

/** Variables an enclosing Claude Code session sets; a spawned CLI must start fresh, not as its child. */
const NESTED_SESSION_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_SOCKET|MESSAGING_TOKEN|BRIDGE_SESSION_ID))$/;

/** The child's environment: the given one without the enclosing session's variables. */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!NESTED_SESSION_VARS.test(k)) out[k] = v;
  return out;
}

/** Refuse to run with an API key in the environment unless explicitly allowed. */
export function assertNoApiKey(env: NodeJS.ProcessEnv = process.env): void {
  if (env.ANTHROPIC_API_KEY && env.MONITOR_ALLOW_API_KEY !== "1") throw new ApiKeyInEnvironmentError();
}

/** An env setting: unset = the default, an empty string = none. */
function setting(value: string | undefined, fallback: string): string | undefined {
  return value === undefined ? fallback : value === "" ? undefined : value;
}

export function runnerOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): RunnerOptions & { traceFile: string | undefined } {
  const budget = env.MONITOR_MAX_BUDGET_USD;
  return {
    bin: env.CLAUDE_BIN || "claude",
    agent: env.MONITOR_AGENT || DEFAULT_AGENT,
    model: setting(env.MONITOR_MODEL, DEFAULT_MODEL),
    effort: setting(env.MONITOR_EFFORT, DEFAULT_EFFORT),
    maxBudgetUsd: budget === "" || budget === "0" ? null : budget ? Number(budget) : DEFAULT_MAX_BUDGET_USD,
    timeoutMs: env.MONITOR_TURN_TIMEOUT_MS ? Number(env.MONITOR_TURN_TIMEOUT_MS) : DEFAULT_TURN_TIMEOUT_MS,
    traceFile: setting(env.MONITOR_TRACE_FILE, DEFAULT_TRACE_FILE),
    env,
  };
}

/** The exact argument list for one turn (pure, so the tests can pin it). */
export function runnerArgs(input: TurnInput, opts: RunnerOptions = {}): string[] {
  const allowed = opts.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
  const disallowed = opts.disallowedTools ?? DEFAULT_DISALLOWED_TOOLS;
  // stream-json: every event as it happens (the trace); the last event is the same result object json gives
  const args = ["-p", "--agent", opts.agent ?? DEFAULT_AGENT, "--output-format", "stream-json", "--verbose", "--permission-mode", "manual", "--permission-prompts", "none", "--allowedTools", allowed.join(","), "--disallowedTools", disallowed.join(",")];
  if (input.sessionId) {
    args.push("--resume", input.sessionId);
  } else {
    args.push("--session-id", input.newSessionId ?? randomUUID());
    if (input.systemContext) args.push("--append-system-prompt", input.systemContext);
  }
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.maxBudgetUsd != null) args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  // "--" ends option parsing: the prompt can never be swallowed by a variadic tool list or start with a dash
  args.push("--", input.text);
  return args;
}

interface CliResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  permission_denials?: { tool_name?: string }[];
}

/** Parse `--output-format json` output; the object is the whole stdout, or its last line when something else printed first. */
export function parseCliResult(stdout: string): CliResult | null {
  const s = stdout.trim();
  if (!s) return null;
  for (const candidate of [s, s.slice(s.lastIndexOf("\n") + 1)]) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === "object") return v as CliResult;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const AUTH_EXPIRED = /\/login|login expired|not logged in|authentication_failed|oauth/i;

export async function runTurn(input: TurnInput, opts: RunnerOptions = {}): Promise<TurnResult> {
  const env = opts.env ?? process.env;
  assertNoApiKey(env);
  const newSessionId = input.newSessionId ?? randomUUID();
  const args = runnerArgs({ ...input, newSessionId }, opts);
  const sessionId = input.sessionId ?? newSessionId;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  const started = Date.now();

  opts.trace?.begin({ text: input.text, sessionId: input.sessionId, systemContext: input.sessionId ? undefined : input.systemContext });
  return new Promise<TurnResult>((resolve) => {
    const child = spawn(opts.bin ?? "claude", args, { cwd: opts.cwd ?? process.cwd(), env: childEnv(env), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let resultEvent: CliResult | null = null;
    let pending = "";
    const onLine = (line: string) => {
      const s = line.trim();
      if (!s.startsWith("{")) return;
      let e: TraceEvent;
      try {
        e = JSON.parse(s) as TraceEvent;
      } catch {
        return;
      }
      if (e.type === "result") resultEvent = e as unknown as CliResult;
      try {
        opts.onEvent?.(e);
        opts.trace?.event(e);
      } catch {
        /* a trace must never fail a turn */
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      stdout += d;
      pending += d;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    });
    child.stderr.on("data", (d: string) => (stderr += d));
    // SIGINT ends the turn cleanly; SIGTERM a little later if it did not
    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGINT");
      setTimeout(() => child.kill("SIGTERM"), 15_000).unref();
    }, timeoutMs);
    const finish = (r: Omit<TurnResult, "sessionId" | "durationMs">) => {
      clearTimeout(killTimer);
      try {
        opts.trace?.end({ ok: r.ok, error: r.error });
      } catch {
        /* see above */
      }
      resolve({ ...r, sessionId, durationMs: Date.now() - started });
    };
    child.on("error", (e) => finish({ ok: false, text: "", costUsd: null, numTurns: null, authExpired: false, error: `${opts.bin ?? "claude"}: ${e.message}`, denials: [] }));
    child.on("close", (code) => {
      if (pending.trim()) onLine(pending);
      const parsed = resultEvent ?? parseCliResult(stdout);
      const denials = (parsed?.permission_denials ?? []).map((d) => d.tool_name ?? "?");
      const tail = (stderr || stdout).trim().split("\n").slice(-5).join("\n");
      if (timedOut) return finish({ ok: false, text: parsed?.result ?? "", costUsd: parsed?.total_cost_usd ?? null, numTurns: parsed?.num_turns ?? null, authExpired: false, error: `turn timed out after ${timeoutMs} ms`, denials });
      if (!parsed) return finish({ ok: false, text: stdout.trim(), costUsd: null, numTurns: null, authExpired: AUTH_EXPIRED.test(stdout + stderr), error: `claude exited with code ${code}${tail ? `: ${tail}` : ""}`, denials });
      const text = parsed.result ?? "";
      const isError = !!parsed.is_error || (code !== 0 && code !== null);
      const authExpired = isError && AUTH_EXPIRED.test(text + stderr);
      return finish({ ok: !isError, text, costUsd: parsed.total_cost_usd ?? null, numTurns: parsed.num_turns ?? null, authExpired, ...(isError ? { error: parsed.subtype && parsed.subtype !== "success" ? parsed.subtype : text || tail || `exit code ${code}` } : {}), denials });
    });
  });
}
