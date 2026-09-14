import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The trace of a headless turn (docs/heartbeat-bot-plan.md §13): what the daemon sent the agent, every
 * tool call with its input, every tool result (what the model reads next), every reply, and the turn's
 * totals — one line each, appended to a file `npm run monitor -- tail` follows. The system prompt itself
 * (the agent file, the skills, the channel context) is not in the stream; those are files in the repo.
 * Long tool results are cut to `maxChars`; the session transcript keeps them whole.
 */

export interface TraceEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  mcp_servers?: { name: string; status: string }[];
  message?: { model?: string; content?: unknown[] | string };
  error?: { message?: string; formatted?: string } | string;
  rate_limit_info?: { status?: string; rateLimitType?: string };
  is_error?: boolean;
  result?: string;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  permission_denials?: { tool_name?: string }[];
  modelUsage?: Record<string, { costUSD?: number }>;
  [k: string]: unknown;
}

export const DEFAULT_TRACE_CHARS = 1000;
/** Replies and the context are shown whole up to this many characters. */
const WHOLE_TEXT_CHARS = 20_000;

/** One line: whitespace collapsed, cut at `max`. */
function cut(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}… (${one.length} chars)` : one;
}

/** As written: the lines kept, cut only far beyond what a reply or a context reaches. */
function whole(s: string): string {
  const t = s.trim();
  return t.length > WHOLE_TEXT_CHARS ? `${t.slice(0, WHOLE_TEXT_CHARS)}… (${t.length} chars)` : t;
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : JSON.stringify(c))).join(" ");
  return content == null ? "" : JSON.stringify(content);
}

/** The lines one stream event produces; `names` remembers tool-call ids so a result can name its tool. */
export function formatTraceEvent(e: TraceEvent, names: Map<string, string>, maxChars = DEFAULT_TRACE_CHARS): string[] {
  if (e.type === "system") {
    if (e.subtype === "init") return [`● session ${e.session_id ?? "?"} · model ${e.model ?? "?"}${e.mcp_servers?.length ? ` · mcp ${e.mcp_servers.map((s) => `${s.name}:${s.status}`).join(" ")}` : ""}`];
    if (e.subtype === "api_retry" || e.subtype === "api_error") {
      const err = typeof e.error === "string" ? e.error : (e.error?.formatted ?? e.error?.message ?? JSON.stringify(e.error ?? {}));
      return [`⚠ ${e.subtype}: ${cut(err, maxChars)}`];
    }
    return [];
  }
  if (e.type === "rate_limit_event") {
    const s = e.rate_limit_info?.status;
    return s && s !== "allowed" ? [`⚠ rate limit ${s} (${e.rate_limit_info?.rateLimitType ?? "?"})`] : [];
  }
  if (e.type === "assistant") {
    const out: string[] = [];
    const content = e.message?.content;
    if (Array.isArray(content)) {
      for (const block of content as { type?: string; id?: string; name?: string; input?: unknown; text?: string; thinking?: string }[]) {
        if (block.type === "tool_use") {
          if (block.id && block.name) names.set(block.id, block.name);
          out.push(`→ ${block.name ?? "?"} ${cut(JSON.stringify(block.input ?? {}), maxChars)}`);
        } else if (block.type === "text" && block.text?.trim()) {
          out.push(`◆ ${whole(block.text)}`);
        } else if (block.type === "thinking" && block.thinking?.trim()) {
          out.push(`💭 ${whole(block.thinking)}`);
        }
      }
    } else if (typeof content === "string" && content.trim()) out.push(`◆ ${whole(content)}`);
    return out;
  }
  if (e.type === "user") {
    const out: string[] = [];
    const content = e.message?.content;
    if (Array.isArray(content)) {
      for (const block of content as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean; text?: string }[]) {
        if (block.type === "tool_result") out.push(`← ${names.get(block.tool_use_id ?? "") ?? "?"}${block.is_error ? " ✗" : ""} ${cut(blockText(block.content), maxChars)}`);
        else if (block.type === "text" && block.text?.trim()) out.push(`▶ ${cut(block.text, maxChars)}`);
      }
    } else if (typeof content === "string" && content.trim()) out.push(`▶ ${cut(content, maxChars)}`);
    return out;
  }
  if (e.type === "result") {
    const models = e.modelUsage ? Object.entries(e.modelUsage).map(([m, u]) => `${m} $${(u.costUSD ?? 0).toFixed(3)}`).join(", ") : "";
    const denials = e.permission_denials?.length ? ` · denied ${e.permission_denials.map((d) => d.tool_name ?? "?").join(", ")}` : "";
    return [`■ ${e.is_error ? `✗ ${e.subtype ?? "error"}: ${cut(e.result ?? "", maxChars)}` : "✓"} ${e.duration_ms ?? "?"} ms · ${e.num_turns ?? "?"} turns · ≈ $${(e.total_cost_usd ?? 0).toFixed(3)}${models ? ` (${models})` : ""}${denials}`];
  }
  return [];
}

/** What the runner tells the trace about a turn. */
export interface TurnTrace {
  begin(info: { text: string; sessionId: string | null; systemContext?: string }): void;
  event(e: TraceEvent): void;
  end(info: { ok: boolean; error?: string }): void;
}

/** Appends timestamped trace lines to a file. */
export class FileTracer implements TurnTrace {
  private names = new Map<string, string>();

  constructor(
    readonly path: string,
    private readonly maxChars = DEFAULT_TRACE_CHARS,
  ) {
    mkdirSync(dirname(path), { recursive: true });
  }

  /** Every entry starts with the time; an entry's further lines are indented under it. */
  private write(entries: string[]): void {
    if (!entries.length) return;
    const stamp = `[${new Date().toISOString().slice(11, 19)}] `;
    const pad = " ".repeat(stamp.length);
    appendFileSync(this.path, entries.map((e) => `${stamp}${e.replace(/\n/g, `\n${pad}`)}\n`).join(""), "utf8");
  }

  begin(info: { text: string; sessionId: string | null; systemContext?: string }): void {
    this.names = new Map();
    const lines = [`▶ ${info.sessionId ? `resume ${info.sessionId}` : "new session"}`];
    if (info.systemContext) lines.push(`▶ context appended to the system prompt:\n${whole(info.systemContext)}`);
    lines.push(`▶ ${whole(info.text)}`);
    this.write(lines);
  }

  event(e: TraceEvent): void {
    this.write(formatTraceEvent(e, this.names, this.maxChars));
  }

  end(info: { ok: boolean; error?: string }): void {
    if (!info.ok) this.write([`■ ✗ ${info.error ?? "failed"}`]);
    this.write([""]);
  }
}
