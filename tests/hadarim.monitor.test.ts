import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import type { Channel, Inbound, Participant } from "../src/hadarim/messaging/channel";
import { createConsoleChannel } from "../src/hadarim/messaging/console";
import { channelContextHe } from "../src/hadarim/messaging/context";
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
    expect(args.slice(0, 5)).toEqual(["-p", "--agent", "bakara", "--output-format", "json"]);
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
    expect(args[args.length - 1]).toBe("שלום");
  });

  it("resumes an existing session without touching the system prompt, and keeps a leading dash positional", () => {
    const args = runnerArgs({ sessionId: "sid-9", text: "-1", systemContext: "ctx" }, { model: "opus", maxBudgetUsd: 2 });
    expect(args[args.indexOf("--resume") + 1]).toBe("sid-9");
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--append-system-prompt");
    expect(args[args.indexOf("--model") + 1]).toBe("opus");
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("2");
    expect(args[args.length - 1]).toBe(" -1");
  });

  it("refuses an API key in the environment unless allowed on purpose; reads its settings from the environment", () => {
    expect(() => assertNoApiKey({ ANTHROPIC_API_KEY: "sk-x" })).toThrow(ApiKeyInEnvironmentError);
    expect(() => assertNoApiKey({ ANTHROPIC_API_KEY: "sk-x", MONITOR_ALLOW_API_KEY: "1" })).not.toThrow();
    expect(() => assertNoApiKey({})).not.toThrow();
    const o = runnerOptionsFromEnv({ CLAUDE_BIN: "/x/claude", MONITOR_MODEL: "sonnet", MONITOR_MAX_BUDGET_USD: "1.5", MONITOR_TURN_TIMEOUT_MS: "1000" });
    expect(o).toMatchObject({ bin: "/x/claude", model: "sonnet", maxBudgetUsd: 1.5, timeoutMs: 1000 });
    expect(runnerOptionsFromEnv({}).maxBudgetUsd).toBe(3);
    expect(runnerOptionsFromEnv({ MONITOR_MAX_BUDGET_USD: "0" }).maxBudgetUsd).toBeNull();
  });

  it("starts the child outside any enclosing Claude Code session", () => {
    const env = childEnv({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_EXECPATH: "/x", HOME: "/h" });
    expect(env).toEqual({ PATH: "/bin", CLAUDE_CODE_EXECPATH: "/x", HOME: "/h" });
  });

  it("parses the json result, also when something printed before it", () => {
    expect(parseCliResult('warning\n{"type":"result","result":"x","session_id":"s"}')).toMatchObject({ result: "x", session_id: "s" });
    expect(parseCliResult("")).toBeNull();
    expect(parseCliResult("not json")).toBeNull();
  });

  it("runs a new turn and a resumed turn through the fake CLI", async () => {
    const log = join(tmp, "args.log");
    const env = { ...cleanEnv, FAKE_CLAUDE_LOG: log };
    const first = await runTurn({ sessionId: null, text: "מה חדש", systemContext: "ctx", newSessionId: "sid-a" }, { bin: FAKE, env, timeoutMs: 10_000 });
    expect(first.ok).toBe(true);
    expect(first.sessionId).toBe("sid-a");
    expect(first.text).toBe("echo(new,ctx): מה חדש");
    expect(first.costUsd).toBe(0.01);
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

  it("ignores unknown senders and answers its own commands without a turn", async () => {
    const { relay, fc, inputs, logs, store } = setup();
    fc.push({ id: "x", from: { channel: "console", address: "STRANGER" }, text: "היי", at: "" });
    fc.push(inbound(eyal, "/סטטוס"));
    await relay.idle();
    await new Promise((r) => setTimeout(r, 5));
    expect(inputs).toHaveLength(0);
    expect(logs.some((l) => l.includes("unknown address"))).toBe(true);
    expect(fc.sent.at(-1)?.text).toContain("אין שיחה פתוחה");
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
    expect(printed).toContain("בקרה:\nתשובה");
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

describe("the monitor stays invisible to the application", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("nothing under src/hadarim outside messaging/ imports the messaging folder", () => {
    const offenders = walk("src/hadarim")
      .filter((f) => !f.includes(`${join("src", "hadarim", "messaging")}`))
      .filter((f) => /from\s+["'][^"']*messaging\//.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the one-shot heartbeat script pre-approves the bakara tools and never waits on a prompt", () => {
    const sh = readFileSync("scripts/heartbeat.sh", "utf8");
    expect(sh).toContain("--allowedTools");
    expect(sh).toContain("mcp__bakara__*");
    expect(sh).toContain("--permission-prompts none");
    expect(sh).not.toContain("--bare");
  });
});
