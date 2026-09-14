/**
 * Shape the agent's text for a chat channel (docs/heartbeat-bot-plan.md §7.4). WhatsApp shows plain
 * text with `*bold*`; it has no headings, tables or code. The agent is asked to write that way; this is
 * the safety net for what still comes out as Markdown. Pure, tested in tests/hadarim.monitor.test.ts.
 */

export const DEFAULT_MAX_MESSAGE_CHARS = 3500;

function tableBlockToLines(rows: string[]): string[] {
  const cells = rows
    .map((r) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()))
    .filter((cs) => !cs.every((c) => /^:?-{2,}:?$/.test(c) || c === ""));
  if (!cells.length) return [];
  const [header, ...body] = cells;
  const width = header.length;
  const out: string[] = [];
  if (width === 2) {
    // a field/value table reads best as "field: value" lines; its header is noise
    for (const r of body) out.push(`${r[0]}: ${r.slice(1).join(" · ")}`);
    if (!body.length) out.push(header.join(": "));
  } else {
    out.push(`*${header.join(" · ")}*`);
    for (const r of body) out.push(r.join(" · "));
  }
  return out;
}

/** Markdown-ish text → chat text: bold kept as *x*, headings bold, tables to lines, no code fences, bullets. */
export function shapeForChat(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  // code fences: keep the content, drop the fence lines
  t = t.replace(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm, "$1");
  t = t.replace(/^```[^\n]*$/gm, "");

  const lines = t.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const block: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) block.push(lines[i++]);
      i--;
      out.push(...tableBlockToLines(block));
      continue;
    }
    let l = line;
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) continue; // horizontal rule
    l = l.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/, "*$1*"); // heading → bold line
    l = l.replace(/^\s*>\s?/, ""); // blockquote marker
    l = l.replace(/^(\s*)[-*+]\s+/, "$1• "); // bullet
    out.push(l);
  }
  t = out.join("\n");

  t = t.replace(/\*\*(.+?)\*\*/g, "*$1*"); // **bold** → *bold*
  t = t.replace(/__(.+?)__/g, "*$1*");
  t = t.replace(/`([^`\n]+)`/g, "$1"); // inline code
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)"); // links
  t = t.replace(/[ \t]+$/gm, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/**
 * Does the reply wait for an answer? True when its last paragraph has a line ending in a question mark
 * or carries numbered options — the shape of a card's decision ("מה לעשות?" followed by 1. 2. 3.).
 */
export function endsWithQuestion(text: string): boolean {
  const paragraphs = text.trim().split(/\n{2,}/);
  const last = paragraphs[paragraphs.length - 1] ?? "";
  const lines = last.split("\n").map((l) => l.trim());
  if (lines.some((l) => /[?؟]\s*$/.test(l))) return true;
  return lines.filter((l) => /^\d+[.)]\s/.test(l)).length >= 2;
}

/** Split a long text into messages of at most `max` characters, on paragraph, then line, boundaries. */
export function splitMessage(text: string, max = DEFAULT_MAX_MESSAGE_CHARS): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const parts: string[] = [];
  let current = "";
  const push = (piece: string, sep: string) => {
    if (!current) current = piece;
    else if (current.length + sep.length + piece.length <= max) current += sep + piece;
    else {
      parts.push(current);
      current = piece;
    }
  };
  for (const para of t.split(/\n{2,}/)) {
    if (para.length <= max) {
      push(para, "\n\n");
      continue;
    }
    for (const line of para.split("\n")) {
      if (line.length <= max) {
        push(line, "\n");
        continue;
      }
      for (let i = 0; i < line.length; i += max) push(line.slice(i, i + max), "\n");
    }
  }
  if (current) parts.push(current);
  return parts;
}
