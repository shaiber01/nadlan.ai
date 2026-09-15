import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentsMonitor, erpMonitor, type ProbeReads } from "../src/hadarim/messaging/probe";
import { heartbeatAlonePromptHe, heartbeatPromptHe } from "../src/hadarim/messaging/prompts";
import { Scheduler, dueMonitors, intervalFor, nextDelayMs, type MonitorDef, type MonitorId, type MonitorSettings, type ProbeResult } from "../src/hadarim/messaging/scheduler";
import { daemonAlive, rowToSettings, settingsChangeKey } from "../src/hadarim/messaging/settings";
import { createPublicKey, generateKeyPairSync, verify as verifySignature } from "node:crypto";
import { maskAddress, type MessageRow } from "../src/hadarim/messaging/inbox";
import { applicationJwt, authorizationHeader, createVonageChannel, decideSend, mediaFileName, sendWhatsAppText, type FetchLike, type VonageConfig, type VonageInboxAccess } from "../src/hadarim/messaging/vonage";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { parseInbound, parseStatus, signWebhook, verifySignedWebhook } from "../supabase/functions/_shared/vonage";
import { FileTracer, formatTraceEvent } from "../src/hadarim/messaging/trace";
import type { Channel, Inbound, Participant } from "../src/hadarim/messaging/channel";
import { createConsoleChannel } from "../src/hadarim/messaging/console";
import { channelContextHe, contextKeyOf } from "../src/hadarim/messaging/context";
import { FileConversationStore, MemoryConversationStore } from "../src/hadarim/messaging/conversations";
import { RELAY_TEXT_HE, Relay } from "../src/hadarim/messaging/relay";
import { ApiKeyInEnvironmentError, DEFAULT_ALLOWED_TOOLS, DEFAULT_DISALLOWED_TOOLS, assertNoApiKey, childEnv, parseCliResult, runTurn, runnerArgs, runnerOptionsFromEnv, type TurnInput, type TurnResult } from "../src/hadarim/messaging/session-runner";
import { endsWithQuestion, shapeForChat, splitMessage } from "../src/hadarim/messaging/shape";

/**
 * Phase 0 of docs/heartbeat-bot-plan.md: the session runner (`claude -p` per turn, resumed by id, under
 * the login), the text shaper, the relay with the console channel — all offline, the CLI replaced by
 * tests/fixtures/fake-claude.mjs. And the invisibility rule: nothing existing imports the messaging folder.
 */

const FAKE = resolve("tests/fixtures/fake-claude.mjs");
const cleanEnv = { PATH: process.env.PATH ?? "" };
const tmp = mkdtempSync(join(tmpdir(), "bakara-monitor-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const eyal: Participant = { address: { channel: "console", address: "P1" }, personId: "P1", nameHe: "אייל", roleHe: "מנהל פרויקט", notify: true };
const roi: Participant = { address: { channel: "console", address: "P2" }, personId: "P2", nameHe: "רועי", roleHe: "סמנכ״ל", notify: true };
const inbound = (p: Participant, text: string): Inbound => ({ id: `${p.personId}-${text}`, from: p.address, text, at: "2026-09-14T10:00:00.000Z" });

function fakeChannel() {
  const sent: { to: string; text: string }[] = [];
  let handler: ((m: Inbound) => void) | null = null;
  const channel: Channel = {
    id: "console",
    send: async (to, text) => {
      sent.push({ to: to.address, text });
      return { providerMessageId: String(sent.length) };
    },
    start: (h) => {
      handler = h;
      return () => (handler = null);
    },
  };
  return { channel, sent, push: (m: Inbound) => handler?.(m) };
}

describe("session runner: the claude -p command", () => {
  it("pins the flags: print mode, the agent, json, manual permissions with no prompts, the allow and deny lists, never bare", () => {
    const args = runnerArgs({ sessionId: null, text: "שלום", systemContext: "ctx", newSessionId: "sid-1" });
    expect(args.slice(0, 6)).toEqual(["-p", "--agent", "shraga", "--output-format", "stream-json", "--verbose"]);
    expect(args).toContain("--permission-prompts");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("manual");
    expect(args[args.indexOf("--permission-prompts") + 1]).toBe("none");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(DEFAULT_ALLOWED_TOOLS.join(","));
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe(DEFAULT_DISALLOWED_TOOLS.join(","));
    expect(DEFAULT_DISALLOWED_TOOLS).toEqual(expect.arrayContaining(["mcp__bakara__reset_project", "mcp__supabase__execute_sql", "Bash"]));
    expect(args).not.toContain("--bare");
    // a new session: its id is chosen up front and the channel context is appended once
    expect(args[args.indexOf("--session-id") + 1]).toBe("sid-1");
    expect(args[args.indexOf("--append-system-prompt") + 1]).toBe("ctx");
    expect(args.slice(-2)).toEqual(["--", "שלום"]);
  });

  it("resumes an existing session without touching the system prompt; a prompt starting with a dash stays a prompt", () => {
    const args = runnerArgs({ sessionId: "sid-9", text: "-1", systemContext: "ctx" }, { model: "opus", effort: "high", maxBudgetUsd: 2 });
    expect(args[args.indexOf("--resume") + 1]).toBe("sid-9");
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--append-system-prompt");
    expect(args[args.indexOf("--model") + 1]).toBe("opus");
    expect(args[args.indexOf("--effort") + 1]).toBe("high");
    const plain = runnerArgs({ sessionId: "sid-9", text: "x" });
    expect(plain).not.toContain("--model");
    expect(plain).not.toContain("--effort");
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("2");
    expect(args.slice(-2)).toEqual(["--", "-1"]);
  });

  it("refuses an API key in the environment unless allowed on purpose; reads its settings from the environment", () => {
    expect(() => assertNoApiKey({ ANTHROPIC_API_KEY: "sk-x" })).toThrow(ApiKeyInEnvironmentError);
    expect(() => assertNoApiKey({ ANTHROPIC_API_KEY: "sk-x", MONITOR_ALLOW_API_KEY: "1" })).not.toThrow();
    expect(() => assertNoApiKey({})).not.toThrow();
    const o = runnerOptionsFromEnv({ CLAUDE_BIN: "/x/claude", MONITOR_MODEL: "opus", MONITOR_EFFORT: "xhigh", MONITOR_MAX_BUDGET_USD: "1.5", MONITOR_TURN_TIMEOUT_MS: "1000", MONITOR_TRACE_FILE: "/t/trace.log" });
    expect(o).toMatchObject({ bin: "/x/claude", model: "opus", effort: "xhigh", maxBudgetUsd: 1.5, timeoutMs: 1000, traceFile: "/t/trace.log" });
    // the defaults: a fast model at low effort, the trace under out/; an empty string means none
    expect(runnerOptionsFromEnv({})).toMatchObject({ model: "sonnet", effort: "low", maxBudgetUsd: 3, traceFile: "out/monitor-trace.log" });
    expect(runnerOptionsFromEnv({ MONITOR_MODEL: "", MONITOR_EFFORT: "", MONITOR_TRACE_FILE: "" })).toMatchObject({ model: undefined, effort: undefined, traceFile: undefined });
    expect(runnerOptionsFromEnv({ MONITOR_MAX_BUDGET_USD: "0" }).maxBudgetUsd).toBeNull();
  });

  it("starts the child outside any enclosing Claude Code session", () => {
    const env = childEnv({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_EXECPATH: "/x", HOME: "/h" });
    expect(env).toEqual({ PATH: "/bin", CLAUDE_CODE_EXECPATH: "/x", HOME: "/h" });
  });

  it("formats stream events into trace lines: tool calls named on their results, replies, retries, the totals", () => {
    const names = new Map<string, string>();
    expect(formatTraceEvent({ type: "system", subtype: "init", session_id: "s1", model: "claude-sonnet-5", mcp_servers: [{ name: "bakara", status: "connected" }] }, names)).toEqual(["● session s1 · model claude-sonnet-5 · mcp bakara:connected"]);
    expect(formatTraceEvent({ type: "system", subtype: "hook_started" }, names)).toEqual([]);
    expect(formatTraceEvent({ type: "assistant", message: { content: [{ type: "thinking", thinking: "" }, { type: "tool_use", id: "t1", name: "get_forecast", input: { sectionId: "03" } }] } }, names)).toEqual(['→ get_forecast {"sectionId":"03"}']);
    expect(formatTraceEvent({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "x".repeat(50) }] }] } }, names, 20)).toEqual([`← get_forecast ${"x".repeat(20)}… (50 chars)`]);
    // replies are kept as written, line breaks included; thinking summaries appear when the model returns them
    expect(formatTraceEvent({ type: "assistant", message: { content: [{ type: "text", text: "תחזית לגמר\n48,240,000 ₪" }] } }, names)).toEqual(["◆ תחזית לגמר\n48,240,000 ₪"]);
    expect(formatTraceEvent({ type: "assistant", message: { content: [{ type: "thinking", thinking: "  " }, { type: "thinking", thinking: "בודק את התחזית" }] } }, names)).toEqual(["💭 בודק את התחזית"]);
    expect(formatTraceEvent({ type: "system", subtype: "api_error", error: { formatted: "Connection lost while your computer was asleep" } }, names)).toEqual(["⚠ api_error: Connection lost while your computer was asleep"]);
    expect(formatTraceEvent({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }, names)).toEqual([]);
    expect(formatTraceEvent({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour" } }, names)).toEqual(["⚠ rate limit rejected (five_hour)"]);
    expect(formatTraceEvent({ type: "result", is_error: true, subtype: "error_during_execution", result: "boom", duration_ms: 9, num_turns: 2, total_cost_usd: 0.5, permission_denials: [{ tool_name: "Bash" }] }, names)).toEqual(["■ ✗ error_during_execution: boom 9 ms · 2 turns · ≈ $0.500 · denied Bash"]);
  });

  it("parses the json result, also when something printed before it", () => {
    expect(parseCliResult('warning\n{"type":"result","result":"x","session_id":"s"}')).toMatchObject({ result: "x", session_id: "s" });
    expect(parseCliResult("")).toBeNull();
    expect(parseCliResult("not json")).toBeNull();
  });

  it("runs a new turn and a resumed turn through the fake CLI, streaming every event to the trace", async () => {
    const log = join(tmp, "args.log");
    const env = { ...cleanEnv, FAKE_CLAUDE_LOG: log };
    const events: string[] = [];
    const tracePath = join(tmp, "trace.log");
    const tracer = new FileTracer(tracePath, 80);
    const first = await runTurn({ sessionId: null, text: "מה חדש", systemContext: "ctx", newSessionId: "sid-a" }, { bin: FAKE, env, timeoutMs: 10_000, model: "sonnet", effort: "low", onEvent: (e) => events.push(`${e.type}${e.subtype ? `/${e.subtype}` : ""}`), trace: tracer });
    expect(first.ok).toBe(true);
    expect(first.sessionId).toBe("sid-a");
    expect(first.text).toBe("echo(new,ctx): מה חדש");
    expect(first.costUsd).toBe(0.01);
    expect(events).toEqual(["system/init", "assistant", "user", "assistant", "result/success"]);
    const trace = readFileSync(tracePath, "utf8");
    expect(trace).toContain("▶ new session");
    expect(trace).toContain("▶ context appended to the system prompt:\n           ctx");
    expect(trace).toContain("▶ מה חדש");
    expect(trace).toContain("● session sid-a · model claude-sonnet-fake · mcp bakara:connected");
    expect(trace).toContain('→ get_project {"projectId":"HADARIM"}');
    expect(trace).toMatch(/← get_project \{"project":\{"id":"HADARIM"/);
    expect(trace).toContain("◆ echo(new,ctx): מה חדש");
    expect(trace).toMatch(/■ ✓ 5 ms · 1 turns · ≈ \$0\.010 \(claude-sonnet-fake \$0\.010\)/);
    const second = await runTurn({ sessionId: first.sessionId, text: "1" }, { bin: FAKE, env, timeoutMs: 10_000 });
    expect(second.ok).toBe(true);
    expect(second.sessionId).toBe("sid-a");
    expect(second.text).toBe("echo(resumed): 1");
    const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("--resume");
  });

  it("reports a failed run, an expired login and a timeout without throwing", async () => {
    const failed = await runTurn({ sessionId: "s", text: "FAIL" }, { bin: FAKE, env: cleanEnv, timeoutMs: 10_000 });
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/exited with code 1/);
    expect(failed.error).toMatch(/boom/);
    const login = await runTurn({ sessionId: "s", text: "LOGIN" }, { bin: FAKE, env: cleanEnv, timeoutMs: 10_000 });
    expect(login.ok).toBe(false);
    expect(login.authExpired).toBe(true);
    const slow = await runTurn({ sessionId: "s", text: "SLOW" }, { bin: FAKE, env: cleanEnv, timeoutMs: 300 });
    expect(slow.ok).toBe(false);
    expect(slow.error).toMatch(/timed out/);
    const missing = await runTurn({ sessionId: "s", text: "x" }, { bin: join(tmp, "no-such-cli"), env: cleanEnv, timeoutMs: 1000 });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/no-such-cli/);
  });

  it("refuses to spawn with an API key in the environment", async () => {
    await expect(runTurn({ sessionId: "s", text: "x" }, { bin: FAKE, env: { ...cleanEnv, ANTHROPIC_API_KEY: "sk-x" } })).rejects.toThrow(ApiKeyInEnvironmentError);
  });
});

describe("shaping text for a chat channel", () => {
  it("turns markdown into WhatsApp text: bold, headings, bullets, tables, no code", () => {
    const md = ["## הבעיה", "", "חשבון **1147** נרשם בסעיף `02`.", "", "| שדה | ערך |", "| --- | --- |", "| סכום | 180,000 ₪ |", "| ספק | פלדות הצפון |", "", "- ראשון", "- שני", "", "```", "code line", "```", "", "---", "", "[הדוח](https://x/report.html)"].join("\n");
    const out = shapeForChat(md);
    expect(out).toContain("*הבעיה*");
    expect(out).toContain("חשבון *1147* נרשם בסעיף 02.");
    expect(out).toContain("סכום: 180,000 ₪");
    expect(out).toContain("ספק: פלדות הצפון");
    expect(out).not.toContain("|");
    expect(out).toContain("• ראשון");
    expect(out).toContain("code line");
    expect(out).not.toContain("```");
    expect(out).not.toContain("---");
    expect(out).toContain("הדוח (https://x/report.html)");
    expect(out).not.toMatch(/\n{3,}/);
  });

  it("keeps a wide table as one line per row with a bold header, and numbered lists as they are", () => {
    const out = shapeForChat("| א | ב | ג |\n|---|---|---|\n| 1 | 2 | 3 |\n\n1. כן\n2. לא");
    expect(out).toBe("*א · ב · ג*\n1 · 2 · 3\n\n1. כן\n2. לא");
  });

  it("knows when a reply waits for an answer: a closing question, or numbered options under one", () => {
    expect(endsWithQuestion("הבעיה: …\n\nמה לעשות?")).toBe(true);
    expect(endsWithQuestion("הבעיה: …\n\nמה לעשות?\n1. לברר עם שרית — המסמך נשאר ממתין.\n2. לעבד עכשיו.\n3. כמו 2 ובנוסף משימה.")).toBe(true);
    expect(endsWithQuestion("מאיפה הסטייה:\n1. סעיף 03\n2. סעיף 01\n\nסיכום: סטייה של +240,000 ₪.")).toBe(false);
    expect(endsWithQuestion("המקור: רשימת חשבונות ספקים של סעיף 03.")).toBe(false);
    expect(endsWithQuestion("")).toBe(false);
  });

  it("splits long text at paragraph, then line, boundaries", () => {
    expect(splitMessage("", 10)).toEqual([]);
    expect(splitMessage("קצר", 10)).toEqual(["קצר"]);
    const paras = ["אאאאא", "בבבבב", "גגגגג"].join("\n\n");
    expect(splitMessage(paras, 12)).toEqual(["אאאאא\n\nבבבבב", "גגגגג"]);
    const lines = ["1234567", "abcdefg", "hijklmn"].join("\n");
    expect(splitMessage(lines, 15)).toEqual(["1234567\nabcdefg", "hijklmn"]);
    expect(splitMessage("x".repeat(25), 10)).toEqual(["xxxxxxxxxx", "xxxxxxxxxx", "xxxxx"]);
  });
});

describe("the channel context", () => {
  it("names the people with their ids, the sender prefix, the attribution rule and the chat rules", () => {
    const ctx = channelContextHe([eyal, roi], "vonage");
    expect(ctx).toContain("וואטסאפ");
    expect(ctx).toContain("אייל (מנהל פרויקט; מזהה לכלים: P1)");
    expect(ctx).toContain("רועי");
    expect(ctx).toContain("byId");
    expect(ctx).toContain("AskUserQuestion");
    expect(ctx).toContain("רשימה ממוספרת");
    expect(ctx).not.toContain("הדוח החי");
    const withReport = channelContextHe([eyal], "vonage", { reportUrl: "https://x/report.html" });
    expect(withReport).toContain("https://x/report.html");
    expect(withReport).toContain("Word");
    expect(ctx).toContain("[קובץ התקבל:");
    expect(ctx).toContain("add_document");
    // the key follows the text: other people or another link mean another conversation
    expect(contextKeyOf(ctx)).toBe(contextKeyOf(channelContextHe([eyal, roi], "vonage")));
    expect(contextKeyOf(ctx)).not.toBe(contextKeyOf(withReport));
    expect(contextKeyOf(ctx)).not.toBe(contextKeyOf(channelContextHe([eyal], "vonage")));
  });
});

describe("the relay", () => {
  function setup(runner?: (input: TurnInput) => Promise<TurnResult>, participants: Participant[] = [eyal]) {
    const fc = fakeChannel();
    const store = new MemoryConversationStore();
    const inputs: TurnInput[] = [];
    const logs: string[] = [];
    let n = 0;
    const runTurnFake: (input: TurnInput) => Promise<TurnResult> =
      runner ??
      (async (input) => {
        n++;
        return { ok: true, sessionId: input.sessionId ?? "sid-new", text: `תשובה ${n} ל: ${input.text}`, costUsd: 0.02, durationMs: 1, numTurns: 1, authExpired: false, denials: [] };
      });
    const relay = new Relay({ projectId: "P", participants, channel: fc.channel, store, runTurn: async (i) => { inputs.push(i); return runTurnFake(i); }, log: (l) => logs.push(l) });
    relay.start();
    return { relay, fc, store, inputs, logs };
  }

  it("runs a person's message as a prefixed turn, creates the conversation with the context, mirrors the reply", async () => {
    const { relay, fc, store, inputs } = setup();
    fc.push(inbound(eyal, "מה חדש?"));
    await relay.idle();
    expect(inputs).toHaveLength(1);
    expect(inputs[0].sessionId).toBeNull();
    expect(inputs[0].text).toBe("אייל: מה חדש?");
    expect(inputs[0].systemContext).toContain("אייל");
    expect(fc.sent).toEqual([{ to: "P1", text: "תשובה 1 ל: אייל: מה חדש?" }]);
    const c = await store.get("P", "project", null);
    expect(c).toMatchObject({ sessionId: "sid-new", turns: 1, pendingQuestion: true });
    // the next message resumes the session and carries no context
    fc.push(inbound(eyal, "1"));
    await relay.idle();
    expect(inputs[1]).toMatchObject({ sessionId: "sid-new", text: "אייל: 1" });
    expect(inputs[1].systemContext).toBeUndefined();
    expect((await store.get("P", "project", null))?.turns).toBe(2);
  });

  it("ignores unknown senders and answers its own commands and the sandbox's pairing phrase without a turn", async () => {
    const { relay, fc, inputs, logs, store } = setup();
    fc.push({ id: "x", from: { channel: "console", address: "STRANGER" }, text: "היי", at: "" });
    fc.push(inbound(eyal, "/סטטוס"));
    await relay.idle();
    await new Promise((r) => setTimeout(r, 5));
    expect(inputs).toHaveLength(0);
    expect(logs.some((l) => l.includes("unknown address"))).toBe(true);
    expect(fc.sent.at(-1)?.text).toContain("אין שיחה פתוחה");
    fc.push(inbound(eyal, "Join rerun hut"));
    await new Promise((r) => setTimeout(r, 5));
    expect(inputs).toHaveLength(0);
    expect(fc.sent.at(-1)).toEqual({ to: "P1", text: RELAY_TEXT_HE.paired });
    fc.push(inbound(eyal, "שלום"));
    await relay.idle();
    expect(await store.get("P", "project", null)).not.toBeNull();
    fc.push(inbound(eyal, "/חדש"));
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.get("P", "project", null)).toBeNull();
    expect(fc.sent.at(-1)?.text).toBe(RELAY_TEXT_HE.newConversation);
  });

  it("queues messages that arrive during a turn and joins them, each with its sender, into the next turn; replies go to everyone", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const { relay, fc, inputs } = setup(async () => {
      calls++;
      if (calls === 1) await gate;
      return { ok: true, sessionId: "sid", text: `ok ${calls}`, costUsd: null, durationMs: 1, numTurns: 1, authExpired: false, denials: [] };
    }, [eyal, roi]);
    fc.push(inbound(eyal, "תכין בקרה"));
    await new Promise((r) => setTimeout(r, 5));
    fc.push(inbound(roi, "1"));
    fc.push(inbound(eyal, "בעצם 2"));
    release();
    await relay.idle();
    expect(inputs).toHaveLength(2);
    expect(inputs[1].text).toBe("רועי: 1\nאייל: בעצם 2");
    expect(fc.sent.map((s) => s.to)).toEqual(["P1", "P2", "P1", "P2"]);
  });

  it("tells everyone when a turn fails, and stops running after the login expired", async () => {
    let mode: "fail" | "login" | "ok" = "fail";
    const { relay, fc, inputs } = setup(async () => ({ ok: mode === "ok", sessionId: "s", text: "", costUsd: null, durationMs: 1, numTurns: null, authExpired: mode === "login", error: mode, denials: [] }));
    fc.push(inbound(eyal, "א"));
    await relay.idle();
    expect(fc.sent.at(-1)?.text).toBe(RELAY_TEXT_HE.failed);
    expect(relay.status.lastError).toBe("fail");
    mode = "login";
    fc.push(inbound(eyal, "ב"));
    await relay.idle();
    expect(fc.sent.at(-1)?.text).toBe(RELAY_TEXT_HE.authExpired);
    expect(relay.status.authExpired).toBe(true);
    mode = "ok";
    fc.push(inbound(eyal, "ג"));
    await relay.idle();
    expect(fc.sent.at(-1)?.text).toBe(RELAY_TEXT_HE.notConnected);
    expect(inputs).toHaveLength(2);
  });

  it("starts a new conversation when the channel context changed, and resumes when it did not", async () => {
    const fc = fakeChannel();
    const store = new MemoryConversationStore();
    const inputs: TurnInput[] = [];
    const runTurn = async (i: TurnInput): Promise<TurnResult> => {
      inputs.push(i);
      return { ok: true, sessionId: i.sessionId ?? `s${inputs.length}`, text: "ok", costUsd: null, durationMs: 1, numTurns: 1, authExpired: false, denials: [] };
    };
    const first = new Relay({ projectId: "P", participants: [eyal], channel: fc.channel, store, runTurn });
    first.start();
    fc.push(inbound(eyal, "א"));
    await first.idle();
    expect((await store.get("P", "project", null))?.contextKey).toBe(first.contextKey);
    // the same people and link: the session is resumed
    const same = new Relay({ projectId: "P", participants: [eyal], channel: fc.channel, store, runTurn });
    same.start();
    fc.push(inbound(eyal, "ב"));
    await same.idle();
    expect(inputs[1]).toMatchObject({ sessionId: "s1" });
    // another participant joins: a new session with the new context
    const changed = new Relay({ projectId: "P", participants: [eyal, roi], channel: fc.channel, store, runTurn, reportUrl: "https://x/report.html" });
    changed.start();
    fc.push(inbound(roi, "ג"));
    await changed.idle();
    expect(inputs[2].sessionId).toBeNull();
    expect(inputs[2].systemContext).toContain("רועי");
    expect(inputs[2].systemContext).toContain("https://x/report.html");
    expect((await store.get("P", "project", null))).toMatchObject({ sessionId: "s3", turns: 1, contextKey: changed.contextKey });
  });

  it("splits a long reply into several messages in order", async () => {
    const fc = fakeChannel();
    const relay = new Relay({ projectId: "P", participants: [eyal], channel: fc.channel, store: new MemoryConversationStore(), maxMessageChars: 12, runTurn: async () => ({ ok: true, sessionId: "s", text: "אאאאא\n\nבבבבב\n\nגגגגג", costUsd: null, durationMs: 1, numTurns: 1, authExpired: false, denials: [] }) });
    relay.start();
    fc.push(inbound(eyal, "x"));
    await relay.idle();
    expect(fc.sent.map((s) => s.text)).toEqual(["אאאאא\n\nבבבבב", "גגגגג"]);
  });
});

describe("the console channel and the file store", () => {
  it("turns typed lines into inbound messages from the chosen person and prints replies", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let printed = "";
    output.on("data", (d) => (printed += String(d)));
    const ch = createConsoleChannel({ as: "P1", input, output, promptHe: "אייל" });
    const got: Inbound[] = [];
    const stop = ch.start((m) => got.push(m));
    input.write("שלום\n\n  \n");
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ from: { channel: "console", address: "P1" }, text: "שלום" });
    await ch.send({ channel: "console", address: "P1" }, "תשובה");
    expect(printed).toContain("שרגא:\nתשובה");
    expect(printed).toContain("אייל> ");
    stop();
  });

  it("keeps conversations in a file and reads them back", async () => {
    const path = join(tmp, "conv", "conversations.json");
    const a = new FileConversationStore(path);
    await a.save({ projectId: "P", scope: "project", address: null, sessionId: "s1", startedAt: "t", lastTurnAt: null, turns: 1, pendingQuestion: false });
    const b = new FileConversationStore(path);
    expect(await b.get("P", "project", null)).toMatchObject({ sessionId: "s1" });
    await b.remove("P", "project", null);
    expect(await new FileConversationStore(path).list()).toEqual([]);
  });
});

describe("the scheduler", () => {
  const settings = (over: Partial<MonitorSettings> = {}): MonitorSettings => ({ projectId: "P", enabled: true, intervalSeconds: 20, notifyOnQuiet: true, wakeOnChange: true, monitors: {}, lastTickAt: null, lastTickFoundWork: null, updatedBy: null, updatedAt: null, ...over });

  function build(over: Partial<MonitorSettings> = {}) {
    let current = settings(over);
    let work = false;
    let passOk = true;
    const probes: MonitorId[] = [];
    const passes: ProbeResult[][] = [];
    const ticks: boolean[] = [];
    const monitor = (id: MonitorId): MonitorDef => ({ id, probe: async () => { probes.push(id); return { monitor: id, work, detailHe: work ? "יש" : "אין" }; } });
    const s = new Scheduler({
      projectId: "P",
      readSettings: async () => current,
      monitors: [monitor("documents"), monitor("erp")],
      runPass: async (r) => { passes.push(r); if (!passOk) throw new Error("boom"); return { ok: true }; },
      recordTick: async (_at, found) => { ticks.push(found); },
    });
    return { s, probes, passes, ticks, set: (o: Partial<MonitorSettings>) => (current = settings(o)), setWork: (w: boolean) => (work = w), setPassOk: (v: boolean) => (passOk = v) };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("disabled: the first tick finds no work to schedule and leaves no timer", async () => {
    const { s, probes } = build({ enabled: false });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(probes).toEqual([]);
    expect(s.state.timerSet).toBe(false);
    s.stop();
  });

  it("enabled: probes at start and every interval, records each tick, runs no pass without work", async () => {
    const { s, probes, passes, ticks } = build();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(probes).toEqual(["documents", "erp"]);
    expect(ticks).toEqual([false]);
    expect(passes).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    expect(s.state.nextAt! - Date.now()).toBe(20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(probes).toHaveLength(4);
    expect(ticks).toHaveLength(2);
    s.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("work: one pass, then the next timer counted from the end of the pass", async () => {
    const { s, passes, ticks, setWork } = build();
    setWork(true);
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(passes).toHaveLength(1);
    expect(passes[0].map((r) => r.monitor)).toEqual(["documents", "erp"]);
    expect(ticks).toEqual([true]);
    expect(s.state.failures).toBe(0);
    expect(s.state.timerSet).toBe(true);
    s.stop();
  });

  it("two failed passes: the next tick waits ten intervals", async () => {
    const { s, setWork, setPassOk } = build();
    setWork(true);
    setPassOk(false);
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state.failures).toBe(1);
    expect(s.state.nextAt! - Date.now()).toBe(20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.state.failures).toBe(2);
    expect(s.state.nextAt! - Date.now()).toBe(200_000);
    s.stop();
  });

  it("an unreachable database does not end the chain: the tick retries with a backoff, and the next good tick clears it", async () => {
    let current: MonitorSettings | null = settings();
    let fail = true;
    const probes: MonitorId[] = [];
    const s = new Scheduler({
      projectId: "P",
      readSettings: async () => {
        if (fail) throw new Error("fetch failed");
        return current;
      },
      monitors: [{ id: "erp", probe: async () => { probes.push("erp"); return { monitor: "erp", work: false, detailHe: "אין" }; } }],
      runPass: async () => ({ ok: true }),
    });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    expect(s.state.nextAt! - Date.now()).toBe(15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.state.nextAt! - Date.now()).toBe(30_000);
    expect(s.state.failures).toBe(2);
    fail = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(probes).toEqual(["erp"]);
    expect(s.state.failures).toBe(0);
    expect(s.state.nextAt! - Date.now()).toBe(20_000);
    // probes that all fail count the same way
    current = settings();
    s.stop();
  });

  it("wake re-evaluates at once: off cancels the timer, on restores it, a longer interval reschedules", async () => {
    const { s, set } = build();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    set({ enabled: false });
    s.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    set({ enabled: true, intervalSeconds: 60 });
    s.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    // the monitors ran a moment ago, so the next tick is when the new interval elapses
    expect(s.state.nextAt! - Date.now()).toBe(60_000);
    s.stop();
  });

  it("a forced wake (an ERP change) probes every monitor at once, before its interval elapsed", async () => {
    const { s, probes, passes, setWork } = build({ intervalSeconds: 300 });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(probes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_000);
    s.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(probes).toHaveLength(2); // a plain wake: nothing is due yet
    setWork(true);
    s.wake({ force: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(probes).toHaveLength(4);
    expect(passes).toHaveLength(1);
    // the forced probe reset the cadence: the next timer is a full interval away
    expect(s.state.nextAt! - Date.now()).toBe(300_000);
    s.stop();
  });

  it("per-monitor intervals: each monitor is probed at its own cadence", async () => {
    const { s, probes } = build({ intervalSeconds: 60, monitors: { documents: { intervalSeconds: 15 } } });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(probes).toEqual(["documents", "erp"]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(probes).toEqual(["documents", "erp", "documents"]);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(probes.filter((p) => p === "erp")).toHaveLength(2);
    expect(probes.filter((p) => p === "documents")).toHaveLength(5);
    s.stop();
  });

  it("the pure pieces: interval floor, due monitors, next delay", () => {
    const s = settings({ intervalSeconds: 5, monitors: { erp: { intervalSeconds: 40 } } });
    expect(intervalFor(s, "documents")).toBe(15);
    expect(intervalFor(s, "erp")).toBe(40);
    expect(dueMonitors(s, ["documents", "erp"], 1_000_000, {})).toEqual(["documents", "erp"]);
    expect(dueMonitors(s, ["documents", "erp"], 1_020_000, { documents: 1_000_000, erp: 1_000_000 })).toEqual(["documents"]);
    expect(nextDelayMs(s, ["documents", "erp"], 1_020_000, { documents: 1_020_000, erp: 1_000_000 })).toBe(15_000);
    expect(nextDelayMs(s, ["documents", "erp"], 1_000_000, {})).toBe(0);
  });
});

describe("the probes and the prompts", () => {
  const reads = (latest: number, watermark: number | null, pending: number): ProbeReads => ({ latestChangeLogId: async () => latest, lastHeartbeatWatermark: async () => watermark, countPendingDocuments: async () => pending });

  it("the erp probe compares the change log with the last heartbeat's watermark; the first pass covers the seed's rows", async () => {
    expect(await erpMonitor(reads(11, null, 0)).probe("P")).toMatchObject({ work: true, detailHe: expect.stringContaining("טרם נרשמה") });
    expect(await erpMonitor(reads(0, null, 0)).probe("P")).toMatchObject({ work: false });
    expect(await erpMonitor(reads(11, 11, 0)).probe("P")).toMatchObject({ work: false });
    expect(await erpMonitor(reads(14, 11, 0)).probe("P")).toMatchObject({ work: true, detailHe: expect.stringContaining("3 שינויים") });
  });

  it("the documents probe counts unprocessed documents", async () => {
    expect(await documentsMonitor(reads(0, 0, 0)).probe("P")).toMatchObject({ work: false });
    expect(await documentsMonitor(reads(0, 0, 2)).probe("P")).toMatchObject({ work: true, detailHe: "2 מסמכים ממתינים לעיבוד" });
  });

  it("the heartbeat prompts name the skill, the people and what the probe found; alone, nobody decides", () => {
    const p = heartbeatPromptHe([eyal, roi], [{ monitor: "documents", work: true, detailHe: "1 מסמכים ממתינים לעיבוד" }, { monitor: "erp", work: false, detailHe: "אין" }]);
    expect(p).toContain("/bakara-heartbeat");
    expect(p).toContain("אייל ורועי");
    expect(p).toContain("1 מסמכים ממתינים לעיבוד");
    expect(p).not.toContain("אין;");
    expect(p).toContain("record_heartbeat");
    expect(heartbeatAlonePromptHe("HADARIM")).toContain("אין משתמש בצד השני");
  });

  it("settings rows map to the engine's shape and say whether the daemon is alive", () => {
    const row = { project_id: "P", enabled: true, interval_seconds: 5, notify_on_quiet: false, wake_on_change: false, monitors: { erp: { intervalSeconds: 60 } }, last_tick_at: "2026-09-14T10:00:00.000Z", last_tick_found_work: true, updated_by: "EYAL", updated_at: "2026-09-14T09:00:00.000Z" };
    const s = rowToSettings(row);
    expect(s).toMatchObject({ projectId: "P", enabled: true, intervalSeconds: 15, notifyOnQuiet: false, wakeOnChange: false, monitors: { erp: { intervalSeconds: 60 } }, updatedBy: "EYAL" });
    expect(settingsChangeKey(s)).not.toBe(settingsChangeKey({ ...s, wakeOnChange: true }));
    const at = Date.parse("2026-09-14T10:00:00.000Z");
    expect(daemonAlive(s, at + 30_000)).toBe(true);
    expect(daemonAlive(s, at + 120_000)).toBe(false);
    expect(daemonAlive(null)).toBe(false);
    expect(daemonAlive({ ...s, lastTickAt: null })).toBe(false);
    // the daemon's own tick stamp is not a settings change; the switch, the intervals and the quiet flag are
    expect(settingsChangeKey(s)).toBe(settingsChangeKey({ ...s, lastTickAt: "2026-09-14T10:05:00.000Z", lastTickFoundWork: false, updatedAt: "x" }));
    expect(settingsChangeKey(s)).not.toBe(settingsChangeKey({ ...s, intervalSeconds: 30 }));
    expect(settingsChangeKey(s)).not.toBe(settingsChangeKey({ ...s, enabled: false }));
    expect(settingsChangeKey(null)).toBe("none");
  });
});

describe("the relay's system turns (the heartbeat's pass)", () => {
  function setup(reply: string) {
    const fc = fakeChannel();
    const store = new MemoryConversationStore();
    const relay = new Relay({ projectId: "P", participants: [eyal, roi], channel: fc.channel, store, runTurn: async () => ({ ok: true, sessionId: "s", text: reply, costUsd: null, durationMs: 1, numTurns: 1, authExpired: false, denials: [] }) });
    relay.start();
    return { relay, fc, store };
  }

  it("a pass that asks is delivered to every notified participant and marks the question as waiting", async () => {
    const { relay, fc } = setup("הבעיה: …\n\nמה לעשות?\n1. לתקן\n2. להשאיר");
    const r = await relay.enqueueSystem("פעימת לב", { deliverIfQuiet: false });
    expect(r).toMatchObject({ ok: true, pendingQuestion: true, delivered: true });
    expect(fc.sent.map((s) => s.to)).toEqual(["P1", "P2"]);
    expect(await relay.hasPendingQuestion()).toBe(true);
  });

  it("a quiet pass is kept back (the default) and sent only when the settings ask for the one-liner", async () => {
    const { relay, fc } = setup("קראתי את המסמך; הכול תואם.");
    expect(await relay.enqueueSystem("פעימת לב", { deliverIfQuiet: false })).toMatchObject({ ok: true, pendingQuestion: false, delivered: false });
    expect(fc.sent).toEqual([]);
    expect(await relay.enqueueSystem("פעימת לב", { deliverIfQuiet: true })).toMatchObject({ delivered: true });
    expect(fc.sent).toHaveLength(2);
    const { STANDARD_MONITOR_SETTINGS } = await import("../src/hadarim/messaging/scheduler");
    expect(STANDARD_MONITOR_SETTINGS.notifyOnQuiet).toBe(false);
  });
});

describe("the Vonage webhook (shared with the Edge Function)", () => {
  const inboundText = { message_uuid: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001", to: "14157386102", from: "972500000001", timestamp: "2026-09-14T12:00:00.000Z", channel: "whatsapp", message_type: "text", text: "מה חדש", profile: { name: "אייל" } };

  it("parses an inbound text and an inbound image, and tells a status update apart", () => {
    expect(parseInbound(inboundText)).toEqual({ provider: "vonage", providerMessageId: inboundText.message_uuid, channel: "whatsapp", from: "972500000001", to: "14157386102", text: "מה חדש", media: null, profileName: "אייל", at: "2026-09-14T12:00:00.000Z" });
    const image = parseInbound({ ...inboundText, message_type: "image", text: undefined, image: { url: "https://x/1.jpg", caption: "חשבונית" } });
    expect(image).toMatchObject({ text: "חשבונית", media: { kind: "image", url: "https://x/1.jpg", caption: "חשבונית", name: null } });
    expect(parseInbound({ message_uuid: "m", to: "1", from: "2", timestamp: "t", status: "delivered" })).toBeNull();
    expect(parseInbound("nope")).toBeNull();
    expect(parseStatus({ message_uuid: "m", status: "rejected", timestamp: "t", error: { type: "https://x", code: "1000", reason: "throttled" } })).toEqual({ providerMessageId: "m", status: "rejected", at: "t", error: "https://x · 1000 · throttled" });
    expect(parseStatus(inboundText)).toBeNull();
  });

  it("verifies a signed webhook and rejects a wrong secret, a tampered body, a stale token and no token", async () => {
    const raw = JSON.stringify(inboundText);
    const now = 1_800_000_000;
    const token = await signWebhook(raw, "s3cret", { api_key: "abc" }, now);
    expect(await verifySignedWebhook(`Bearer ${token}`, raw, "s3cret", now)).toMatchObject({ ok: true, claims: { api_key: "abc" } });
    expect(await verifySignedWebhook(`Bearer ${token}`, raw, "other", now)).toMatchObject({ ok: false, reason: "bad signature" });
    expect(await verifySignedWebhook(`Bearer ${token}`, raw.replace("מה חדש", "x"), "s3cret", now)).toMatchObject({ ok: false, reason: "payload hash mismatch" });
    expect(await verifySignedWebhook(`Bearer ${token}`, raw, "s3cret", now + 3600)).toMatchObject({ ok: false, reason: "token too old" });
    expect(await verifySignedWebhook(null, raw, "s3cret", now)).toMatchObject({ ok: false, reason: "no bearer token" });
    expect(await verifySignedWebhook("Bearer a.b", raw, "s3cret", now)).toMatchObject({ ok: false, reason: "malformed token" });
  });
});

describe("the Vonage adapter", () => {
  const cfg: VonageConfig = { apiKey: "key", apiSecret: "secret", from: "14157386102", endpoint: "https://sandbox.test/v1/messages", monthlyCap: 3, windowHours: 24 };
  const T0 = Date.parse("2026-09-14T12:00:00.000Z");

  it("decides by the cap first, then by the 24-hour window", () => {
    expect(decideSend({ nowMs: T0, lastInboundAt: null, sentThisMonth: 3, cap: 3, windowHours: 24 })).toMatchObject({ action: "refuse" });
    expect(decideSend({ nowMs: T0, lastInboundAt: null, sentThisMonth: 0, cap: 3, windowHours: 24 })).toMatchObject({ action: "hold" });
    expect(decideSend({ nowMs: T0, lastInboundAt: new Date(T0 - 25 * 3_600_000).toISOString(), sentThisMonth: 0, cap: 3, windowHours: 24 })).toMatchObject({ action: "hold" });
    expect(decideSend({ nowMs: T0, lastInboundAt: new Date(T0 - 23 * 3_600_000).toISOString(), sentThisMonth: 2, cap: 3, windowHours: 24 })).toEqual({ action: "send" });
  });

  it("signs an application JWT with RS256 and falls back to basic auth", () => {
    const { privateKey: pem, publicKey: publicPem } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const token = applicationJwt("app-1", pem, T0, 60);
    const [h, p, s] = token.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({ application_id: "app-1", iat: T0 / 1000, exp: T0 / 1000 + 60 });
    expect(verifySignature("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey(publicPem), Buffer.from(s, "base64url"))).toBe(true);
    expect(authorizationHeader({ ...cfg, applicationId: "app-1", privateKeyPem: pem }, T0)).toMatch(/^Bearer /);
    expect(authorizationHeader(cfg)).toBe(`Basic ${Buffer.from("key:secret").toString("base64")}`);
  });

  it("posts one text message to the endpoint and returns Vonage's id; a rejection throws", async () => {
    const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
    const ok: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 202, text: async () => JSON.stringify({ message_uuid: "uuid-1" }), arrayBuffer: async () => new ArrayBuffer(0) };
    };
    expect(await sendWhatsAppText(cfg, "972500000001", "שלום", ok, T0)).toEqual({ messageUuid: "uuid-1" });
    expect(calls[0].url).toBe(cfg.endpoint);
    expect(JSON.parse(calls[0].init.body ?? "")).toEqual({ to: "972500000001", from: "14157386102", channel: "whatsapp", message_type: "text", text: "שלום" });
    expect(calls[0].init.headers.authorization).toMatch(/^Basic /);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal); // a send that never returns cannot hold the daemon
    const rejected: FetchLike = async () => ({ ok: false, status: 401, text: async () => "Unauthorized", arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(sendWhatsAppText(cfg, "972500000001", "שלום", rejected)).rejects.toThrow(/vonage 401/);
  });

  function fakeInbox() {
    const rows: MessageRow[] = [];
    const contacts = new Map<string, string | null>([["972500000001", null]]);
    let nextId = 1;
    const sent: string[] = [];
    const inbox: VonageInboxAccess = {
      listReceived: async () => rows.filter((r) => r.direction === "in" && r.status === "received"),
      claimInbound: async (id) => {
        const r = rows.find((x) => x.id === id);
        if (!r || r.status !== "received") return false;
        r.status = "processing";
        return true;
      },
      closeInbound: async (id, status) => {
        rows.find((x) => x.id === id)!.status = status;
      },
      touchContact: async (_c, address, at) => {
        if (!contacts.has(address)) return false;
        contacts.set(address, at);
        return true;
      },
      lastInboundAt: async (_c, address) => contacts.get(address) ?? null,
      countSentThisMonth: async () => rows.filter((r) => r.direction === "out" && r.status === "sent").length,
      recordOutbound: async (m) => {
        rows.push({ id: nextId, channel: m.channel, direction: "out", address: m.address, projectId: m.projectId, personId: m.personId, provider: m.provider, providerMessageId: m.providerMessageId, text: m.text, media: null, status: m.status, sessionId: null, at: new Date().toISOString() });
        return nextId++;
      },
      updateOutbound: async (id, patch) => {
        const r = rows.find((x) => x.id === id)!;
        if (patch.status) r.status = patch.status;
        if (patch.providerMessageId !== undefined) r.providerMessageId = patch.providerMessageId;
      },
      listHeld: async (_c, address) => rows.filter((r) => r.direction === "out" && r.address === address && r.status === "held_window_closed"),
      subscribeInbound: () => () => {},
    };
    const receive = (address: string, text: string) => {
      rows.push({ id: nextId, channel: "whatsapp", direction: "in", address, projectId: null, personId: null, provider: "vonage", providerMessageId: `in-${nextId}`, text, media: null, status: "received", sessionId: null, at: new Date().toISOString() });
      return nextId++;
    };
    const fetched: string[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      if (init.method === "GET") {
        fetched.push(`${url} ${init.headers.authorization ?? ""}`);
        return { ok: true, status: 200, text: async () => "", arrayBuffer: async () => new TextEncoder().encode("JPEGDATA").buffer as ArrayBuffer };
      }
      sent.push(JSON.parse(init.body ?? "").text);
      return { ok: true, status: 202, text: async () => JSON.stringify({ message_uuid: `uuid-${sent.length}` }) , arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const receiveMedia = (address: string, media: Record<string, unknown>, caption: string | null) => {
      rows.push({ id: nextId, channel: "whatsapp", direction: "in", address, projectId: null, personId: null, provider: "vonage", providerMessageId: `in-${nextId}`, text: caption, media, status: "received", sessionId: null, at: new Date().toISOString() });
      return nextId++;
    };
    return { inbox, rows, receive, receiveMedia, sent, fetched, fetchImpl };
  }

  it("brings a received file to the document cache — a simulator's file:// copy, or Vonage's media with the send's authorization — and tells the relay where it is", async () => {
    const { inbox, receiveMedia, fetched, fetchImpl } = fakeInbox();
    const dir = join(tmp, "inbound");
    const photo = join(tmp, "invoice.jpg");
    writeFileSync(photo, "FAKEJPEG");
    const got: Inbound[] = [];
    const channel = createVonageChannel({ cfg, projectId: "P", inbox, isEnrolled: () => true, personIdOf: () => "EYAL", fetchImpl, now: () => T0, pollMs: 60_000, downloadDir: dir });
    const a = receiveMedia("972500000001", { kind: "image", url: pathToFileURL(photo).href, name: "invoice.jpg", caption: "חשבונית ברזל" }, "חשבונית ברזל");
    const b = receiveMedia("972500000001", { kind: "image", url: "https://api-eu.vonage.com/v3/media/abc", caption: null }, null);
    const stop = channel.start((m) => got.push(m));
    await new Promise((res) => setTimeout(res, 30));
    stop();
    expect(got).toHaveLength(2);
    expect(got[0].text).toBe(`[קובץ התקבל: ${join(dir, String(a), "invoice.jpg")}] חשבונית ברזל`);
    expect(readFileSync(join(dir, String(a), "invoice.jpg"), "utf8")).toBe("FAKEJPEG");
    expect(got[1].text).toBe(`[קובץ התקבל: ${join(dir, String(b), `image-${b}.jpg`)}]`);
    expect(readFileSync(join(dir, String(b), `image-${b}.jpg`), "utf8")).toBe("JPEGDATA");
    expect(fetched[0]).toMatch(/^https:\/\/api-eu\.vonage\.com\/v3\/media\/abc Basic /);
    expect(mediaFileName({ kind: "file", url: "https://x/y/quote.pdf" }, 7)).toBe("quote.pdf");
    expect(mediaFileName({ kind: "audio" }, 7)).toBe("audio-7.ogg");
  });

  it("holds a message while the window is closed and releases it when the person writes; hands the message to the relay; ignores strangers", async () => {
    const { inbox, rows, receive, sent, fetchImpl } = fakeInbox();
    const got: Inbound[] = [];
    const channel = createVonageChannel({ cfg, projectId: "P", inbox, isEnrolled: (a) => a === "972500000001", personIdOf: (a) => (a === "972500000001" ? "EYAL" : null), fetchImpl, now: () => T0, pollMs: 60_000 });
    const r = await channel.send({ channel: "whatsapp", address: "972500000001" }, "כרטיס 1");
    expect(r.providerMessageId).toMatch(/^held:/);
    expect(rows.find((x) => x.direction === "out")?.status).toBe("held_window_closed");
    expect(sent).toEqual([]);
    receive("972500000001", "היי");
    receive("972599999999", "מי זה?");
    const stop = channel.start((m) => got.push(m));
    await new Promise((res) => setTimeout(res, 20));
    stop();
    expect(sent).toEqual(["כרטיס 1"]);
    expect(rows.find((x) => x.direction === "out")).toMatchObject({ status: "sent", providerMessageId: "uuid-1" });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ from: { channel: "whatsapp", address: "972500000001" }, text: "היי" });
    expect(rows.filter((x) => x.direction === "in").map((x) => x.status)).toEqual(["done", "ignored"]);
    // the window is open now: the next message goes straight out
    await channel.send({ channel: "whatsapp", address: "972500000001" }, "תשובה");
    expect(sent).toEqual(["כרטיס 1", "תשובה"]);
  });

  it("refuses to send past the monthly cap and records the refusal", async () => {
    const { inbox, rows, fetchImpl } = fakeInbox();
    const channel = createVonageChannel({ cfg: { ...cfg, monthlyCap: 1 }, projectId: "P", inbox, isEnrolled: () => true, personIdOf: () => "EYAL", fetchImpl, now: () => T0 });
    await inbox.touchContact("whatsapp", "972500000001", new Date(T0 - 1000).toISOString());
    await channel.send({ channel: "whatsapp", address: "972500000001" }, "1");
    await expect(channel.send({ channel: "whatsapp", address: "972500000001" }, "2")).rejects.toThrow(/מכסת/);
    expect(rows.filter((x) => x.direction === "out").map((x) => x.status)).toEqual(["sent", "failed"]);
    expect(maskAddress("972500000001")).toBe("…0001");
  });
});

describe("the settings tools", () => {
  it("are in the registry with a floor on the interval and require a change", async () => {
    const { tools } = await import("../src/hadarim/tools");
    const get = tools.find((t) => t.name === "get_monitor_settings")!;
    const set = tools.find((t) => t.name === "set_monitor_settings")!;
    expect(get.kind).toBe("read");
    expect(set.kind).toBe("write");
    const { z } = await import("zod");
    expect(z.object(set.input).safeParse({ intervalSeconds: 5 }).success).toBe(false);
    expect(z.object(set.input).safeParse({ intervalSeconds: 60, enabled: true }).success).toBe(true);
    expect(z.object(set.input).safeParse({ notifyOnQuiet: false }).success).toBe(true);
  });
});

describe("the monitor stays invisible to the application", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("nothing under src/hadarim outside messaging/ imports the messaging folder, except the presenter strip's switch and the two settings tools", () => {
    const allowed = [join("src", "hadarim", "features", "erp", "MonitorSwitch.tsx"), join("src", "hadarim", "tools", "index.ts")];
    const offenders = walk("src/hadarim")
      .filter((f) => !f.includes(`${join("src", "hadarim", "messaging")}`) && !allowed.includes(f))
      .filter((f) => /from\s+["'][^"']*messaging\//.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    // the switch and the tools touch the settings and the contacts only — never the runner, the relay or the scheduler's timers
    for (const f of allowed) {
      const imported = [...readFileSync(f, "utf8").matchAll(/from\s+["'][^"']*messaging\/([a-z-]+)["']/g)].map((m) => m[1]);
      expect(imported.every((m) => ["settings", "scheduler", "inbox"].includes(m)), `${f} imports ${imported.join(", ")}`).toBe(true);
    }
    // the engine, the store and the database client stay ignorant
    for (const f of ["src/hadarim/app/store.ts", "src/hadarim/db/client.ts", "src/hadarim/db/session.ts", "src/hadarim/engine/heartbeat.ts", "src/hadarim/engine/report.ts"]) expect(readFileSync(f, "utf8")).not.toMatch(/monitor_settings|messaging_contacts|conversations/);
  });

  it("the agent gets the two settings tools and the skill names the monitor", () => {
    const agent = readFileSync(".claude/agents/shraga.md", "utf8");
    expect(agent).toContain("mcp__bakara__get_monitor_settings");
    expect(agent).toContain("mcp__bakara__set_monitor_settings");
    expect(readFileSync(".claude/skills/bakara-heartbeat/SKILL.md", "utf8")).toContain("set_monitor_settings");
    expect(readFileSync("scripts/com.nadlan.monitor.plist", "utf8")).toContain("com.nadlan.monitor");
  });

  it("the one-shot heartbeat script pre-approves the bakara tools and never waits on a prompt", () => {
    const sh = readFileSync("scripts/heartbeat.sh", "utf8");
    expect(sh).toContain("--allowedTools");
    expect(sh).toContain("mcp__bakara__*");
    expect(sh).toContain("--permission-prompts none");
    expect(sh).not.toContain("--bare");
  });
});
