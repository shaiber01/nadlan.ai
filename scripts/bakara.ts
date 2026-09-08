/**
 * בקרה — the budget-control engine as a command-line tool over the Supabase project.
 * This is the toolset the Claude agent calls: every number comes from here, never from the model.
 *
 *   npm run bakara -- status
 *   npm run bakara -- reset [--variant A|B]
 *   npm run bakara -- erp set-section <invoiceId> <sectionId> --by SARIT [--note "..."]
 *   npm run bakara -- erp set-po <poId> --qty 12 --unit טון --price 4800 --by EYAL
 *   npm run bakara -- erp set-building <invoiceId> <A|B|משותף> --by EYAL
 *   npm run bakara -- erp new-invoice --supplier SUP-NTB --docno 2026-087 --date 2026-08-31 --amount 180000 --desc "..." --section 02 [--contract 07-01] [--attachment inv_1147_ntb_partial7] --by SARIT
 *   npm run bakara -- control run [--force]        # runs the checks on the live data, opens the session
 *   npm run bakara -- control show
 *   npm run bakara -- decide <finding|kind> <choiceId> | --text "..."
 *   npm run bakara -- route <finding|kind> update|refer_accounting|forecast_only|refer_roi
 *   npm run bakara -- quote <finding|kind> accept|reject
 *   npm run bakara -- config [--trends on|off] [--by-building on|off] [--ceo on|off] [--save]
 *   npm run bakara -- report [--ceo] [--md path] [--docx path] [--label "..."] [--no-save]
 *   npm run bakara -- finalize
 *   npm run bakara -- tool <name> ['{"json":"args"}']   # any tool of the MCP registry (src/hadarim/tools), e.g. tool get_forecast '{"sectionId":"03"}'
 *   npm run bakara -- tools                            # list the registry
 *   Global: --project HADARIM  --json  --by <personId>
 *
 * The agent uses the same registry through the MCP server (mcp/bakara-server.ts); this CLI is the shell wrapper.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { deleteInvoice, resetProject } from "../src/hadarim/db/client";
import { DEFAULT_PROJECT_ID } from "../src/hadarim/db/config";
import { loadState, nowStamp, saveReportVersion, saveState } from "../src/hadarim/db/session";
import type { HFinding } from "../src/hadarim/engine/checks";
import { sectionLabel } from "../src/hadarim/engine/checks";
import { confirmQuote, createInvoice, decide, finalizeControl, pkg, revealAllSteps, reviewFindings, route, saveConfig, setReportConfig, startControl, updateInvoiceBuilding, updateInvoiceSection, updatePurchaseOrder } from "../src/hadarim/engine/commands";
import { workingForecast } from "../src/hadarim/engine/forecast";
import type { ChatMessage, RouteId, V2State } from "../src/hadarim/engine/model";
import { buildReport } from "../src/hadarim/engine/report";
import { exportReportDocx } from "../src/hadarim/export/docx";
import { reportToMarkdown } from "../src/hadarim/export/markdown";
import { callTool, tools } from "../src/hadarim/tools";
import type { BuildingTag, PersonId, SectionId } from "../src/hadarim/data/types";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    project: { type: "string" },
    json: { type: "boolean" },
    by: { type: "string" },
    note: { type: "string" },
    text: { type: "string" },
    force: { type: "boolean" },
    variant: { type: "string" },
    qty: { type: "string" },
    unit: { type: "string" },
    price: { type: "string" },
    supplier: { type: "string" },
    docno: { type: "string" },
    date: { type: "string" },
    amount: { type: "string" },
    desc: { type: "string" },
    section: { type: "string" },
    contract: { type: "string" },
    attachment: { type: "string" },
    trends: { type: "string" },
    "by-building": { type: "string" },
    ceo: { type: "boolean" },
    save: { type: "boolean" },
    "no-save": { type: "boolean" },
    md: { type: "string" },
    docx: { type: "string" },
    label: { type: "string" },
  },
});

const projectId = (opts.project as string | undefined) ?? DEFAULT_PROJECT_ID;
const asJson = !!opts.json;
const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
const out: string[] = [];
const say = (...lines: string[]) => out.push(...(lines.length ? lines : [""]));

function fail(message: string): never {
  if (asJson) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(`✗ ${message}`);
  process.exit(1);
}

function renderMessage(m: ChatMessage, state: V2State): string[] {
  const lines: string[] = [];
  const options = (m.options ?? []).map((o) => `[${o.id}] ${o.labelHe}`).join("  ");
  switch (m.kind) {
    case "steps":
      lines.push(m.textHe, ...(m.steps ?? []).map((s) => `  ✔ ${s.textHe}`));
      break;
    case "finding": {
      const f = state.control.findings.find((x) => x.id === m.findingId);
      if (f) lines.push(...renderFinding(f, state));
      break;
    }
    case "log":
      lines.push(`  📄 ${m.textHe}`);
      break;
    default:
      lines.push(m.textHe);
      if (m.documentId) lines.push(`  מסמך: ${m.documentId}`);
      if (options) lines.push(`  אפשרויות: ${options}`);
  }
  return lines;
}

function renderFinding(f: HFinding, state: V2State): string[] {
  const d = state.control.decisions[f.id];
  const lines = [`━━ ממצא ${f.id} · ${f.kind} · ${sectionLabel(f.sectionId)} · ${f.titleHe}`, `הבעיה: ${f.problemHe}`, "המקורות:", ...f.sources.map((s) => `  - ${s.labelHe}${s.fieldHe ? ` · ${s.fieldHe}${s.valueHe ? `: ${s.valueHe}` : ""}` : ""} [${s.kind} ${s.refId}]${s.documentId ? ` [מסמך ${s.documentId}${s.anchor ? `#${s.anchor}` : ""}]` : ""}`)];
  if (f.checkHe) lines.push(`הבדיקה: ${f.checkHe}`);
  if (f.detailsTable?.length) lines.push(...f.detailsTable.map((r) => `  | ${r.join(" | ")}`));
  lines.push(`המשמעות: ${f.meaningHe}`, `השפעה על התחזית: ${f.impact.labelHe}`);
  if (f.notesHe?.length) lines.push(...f.notesHe.map((n) => `  • ${n}`));
  if (d && d.status !== "open") {
    lines.push(`ההחלטה: ${d.status}${d.routeId ? ` · מסלול ${d.routeId}` : ""}${d.ownerId ? ` · אחראי ${d.ownerId}` : ""}`);
    if (d.auditHe) lines.push(`  תיעוד: ${d.auditHe}`);
    if (d.verifiedHe) lines.push(`  אימות: ${d.verifiedHe}`);
  } else {
    lines.push(`ההחלטה הנדרשת: ${f.decision.questionHe}`, `  אפשרויות: ${f.decision.options.map((o) => `[${o.id}] ${o.labelHe}`).join("  ")}${f.decision.freeText ? "  (או טקסט חופשי עם --text)" : ""}`);
    if (d?.pending) lines.push(`  ממתין: ${JSON.stringify(d.pending)}`);
  }
  return lines;
}

function resolveFinding(state: V2State, ref: string | undefined): HFinding {
  if (!ref) fail("נדרש מזהה ממצא או סוג (allocation | unit | price | coverage)");
  const f = state.control.findings.find((x) => x.id === ref) ?? state.control.findings.find((x) => x.kind === ref);
  if (!f) fail(`ממצא ${ref} לא נמצא. ממצאים: ${state.control.findings.map((x) => `${x.id} (${x.kind})`).join(", ") || "אין — הרץ control run"}`);
  return f;
}

function headline(state: V2State): string {
  const wf = workingForecast(pkg, state.erp, state.control.adjustments, state.control.controlDate);
  const variance = wf.totalEac - wf.totalBudget;
  return `תחזית לגמר ${nis(wf.totalEac)} מול תקציב ${nis(wf.totalBudget)} (${variance === 0 ? "בתוך התקציב" : `${variance > 0 ? "+" : "−"}${nis(Math.abs(variance))}`}) · בקרה קודמת ${nis(wf.previousTotalEac)}`;
}

/** Apply a pure command, persist, print what the engine said. */
async function apply(state: V2State, fn: (s: V2State) => V2State): Promise<V2State> {
  const next = fn(state);
  const before = state.control.messages.length;
  const { state: saved, erpWrites } = await saveState(state, next, projectId);
  for (const m of next.control.messages.slice(before)) {
    if (m.role === "user") continue;
    say(...renderMessage(m, saved));
  }
  if (erpWrites.length) say(`  💾 נכתב למסד הנתונים: ${erpWrites.join(", ")}`);
  return saved;
}

function by(): PersonId {
  return ((opts.by as string | undefined) ?? "EYAL") as PersonId;
}

async function main() {
  const [command, sub, ...rest] = positionals;
  let result: unknown = null;

  if (command === "tools") {
    for (const t of tools) say(`${t.name.padEnd(28)} ${t.kind.padEnd(11)} ${t.title}`);
    result = tools.map((t) => ({ name: t.name, kind: t.kind, title: t.title, args: Object.keys(t.input) }));
  } else if (command === "tool") {
    if (!sub) fail(`tool <name> ['{json}'] · כלים: ${tools.map((t) => t.name).join(", ")}`);
    const args = rest[0] ? (JSON.parse(rest[0]) as Record<string, unknown>) : {};
    result = await callTool(sub, { projectId, ...args });
    say(JSON.stringify(result, null, 2));
  } else if (command === "reset") {
    await resetProject(projectId);
    const variant = ((opts.variant as string | undefined) ?? "A").toUpperCase();
    if (variant === "B") await deleteInvoice(1147, projectId);
    say(`✓ הפרויקט ${projectId} אופס לנתוני הבסיס${variant === "B" ? " (גרסה ב׳: חשבון 1147 הוסר לקליטה חיה)" : ""}`);
    result = { ok: true, variant };
  } else if (command === "status") {
    const state = await loadState(projectId);
    const c = state.control;
    say(`פרויקט ${pkg.project.nameHe} (${projectId}) · ${pkg.project.companyHe} · ${nowStamp().replace("T", " ")}`);
    say(`חשבונות ${state.erp.invoices.length} (בבדיקה ${state.erp.invoices.filter((i) => i.status === "בבדיקה").length}) · הזמנות פתוחות ${state.erp.purchaseOrders.filter((p) => p.status === "פתוחה").length} · יומן שינויים ${state.erp.changeLog.length} רשומות`);
    say(headline(state));
    say(`בקרה ${c.controlDate}: ${c.status}${c.finalized ? " · גרסה סופית" : ""} · ממצאים ${c.findings.length} · הוחלטו ${Object.values(c.decisions).filter((d) => d.status !== "open").length} · התאמות ${c.adjustments.length} · תיקונים ${c.corrections.length} · משימות ${c.tasks.length}`);
    const today = state.clock.slice(0, 10);
    const todays = state.erp.changeLog.filter((x) => x.at.startsWith(today));
    if (todays.length) say(`שינויים היום במערכת המידע: ${todays.map((x) => `${x.recordType} ${x.recordId} — ${x.field} ${x.before} → ${x.after} (${x.byId})`).join("; ")}`);
    result = { project: projectId, control: { ...c, messages: undefined }, headline: headline(state), changesToday: todays };
  } else if (command === "erp") {
    let state = await loadState(projectId);
    const actor = by();
    if (sub === "set-section") {
      const [id, section] = rest;
      if (!id || !section) fail("erp set-section <invoiceId> <sectionId> --by <person>");
      state = await apply(state, (s) => updateInvoiceSection(s, Number(id), section as SectionId, actor, (opts.note as string | undefined) ?? "שינוי ידני במערכת המידע"));
    } else if (sub === "set-po") {
      const [id] = rest;
      if (!id) fail("erp set-po <poId> [--qty] [--unit] [--price] --by <person>");
      const patch: { qty?: number; unit?: string; unitPrice?: number } = {};
      if (opts.qty) patch.qty = Number(opts.qty);
      if (opts.unit) patch.unit = String(opts.unit);
      if (opts.price) patch.unitPrice = Number(opts.price);
      state = await apply(state, (s) => updatePurchaseOrder(s, Number(id), patch, actor, (opts.note as string | undefined) ?? "תיקון במערכת המידע"));
    } else if (sub === "set-building") {
      const [id, building] = rest;
      if (!id || !building) fail("erp set-building <invoiceId> <A|B|משותף> --by <person>");
      state = await apply(state, (s) => updateInvoiceBuilding(s, Number(id), building as BuildingTag, actor));
    } else if (sub === "new-invoice") {
      const need = (k: string) => {
        const v = opts[k as keyof typeof opts];
        if (v == null) fail(`--${k} נדרש`);
        return String(v);
      };
      state = await apply(state, (s) => createInvoice(s, { supplierId: need("supplier"), supplierDocNo: need("docno"), date: need("date"), amount: Number(need("amount")), descriptionHe: need("desc"), sectionId: need("section") as SectionId, contractId: (opts.contract as string | undefined) ?? null, attachmentId: (opts.attachment as string | undefined) ?? null, byId: actor })[0]);
    } else {
      fail("erp set-section | set-po | set-building | new-invoice");
    }
    const recent = state.erp.changeLog.slice(-3);
    say("יומן שינויים (אחרונים):", ...recent.map((x) => `  ${x.at.replace("T", " ")} · ${x.recordType} ${x.recordId} · ${x.field}: ${x.before} → ${x.after} · ${x.byId}${x.noteHe ? ` · ${x.noteHe}` : ""}`));
    result = { ok: true, changeLog: recent };
  } else if (command === "control" && (sub === "run" || sub === undefined)) {
    let state = await loadState(projectId);
    if (state.control.status !== "idle" && !opts.force) {
      say(`הבקרה ${state.control.controlDate} כבר רצה (${state.control.status}). להרצה מחדש: control run --force`);
      say(headline(state));
      result = { ok: false, reason: "already_running" };
    } else {
      if (opts.force) {
        const { db } = await import("../src/hadarim/db/client");
        const del = await db().from("controls").delete().eq("project_id", projectId).eq("control_date", state.control.controlDate);
        if (del.error) fail(del.error.message);
        await db().from("open_issues").delete().eq("project_id", projectId).not("finding_id", "is", null);
        state = await loadState(projectId);
      }
      state = await apply(state, (s) => reviewFindings(revealAllSteps(startControl(s, "תכיני בקרה תקציבית"))));
      say(headline(state));
      result = { ok: true, findings: state.control.findings, positives: state.control.positives, headline: headline(state) };
    }
  } else if (command === "control" && sub === "show") {
    const state = await loadState(projectId);
    say(headline(state));
    for (const f of state.control.findings) say(...renderFinding(f, state), "");
    if (state.control.positives.length) say("נבדק ונמצא תואם:", ...state.control.positives.map((p) => `  ✓ ${p.titleHe} — ${p.textHe}`));
    result = { findings: state.control.findings, decisions: state.control.decisions, adjustments: state.control.adjustments, corrections: state.control.corrections, tasks: state.control.tasks };
  } else if (command === "decide") {
    let state = await loadState(projectId);
    const f = resolveFinding(state, sub);
    const text = opts.text as string | undefined;
    const choice = rest[0];
    if (!text && !choice) fail(`decide ${f.id} <choiceId> או --text "..." · אפשרויות: ${f.decision.options.map((o) => o.id).join(", ")}`);
    state = await apply(state, (s) => decide(s, f.id, choice ?? null, text));
    say(headline(state));
    result = { ok: true, decision: state.control.decisions[f.id], headline: headline(state) };
  } else if (command === "route") {
    let state = await loadState(projectId);
    const f = resolveFinding(state, sub);
    const routeId = rest[0] as RouteId | undefined;
    if (!routeId || !["update", "refer_accounting", "forecast_only", "refer_roi"].includes(routeId)) fail("route <finding> update|refer_accounting|forecast_only|refer_roi");
    state = await apply(state, (s) => route(s, f.id, routeId));
    const d = state.control.decisions[f.id];
    if (d?.verifiedHe) say(`  ✔ ${d.verifiedHe}`);
    say(headline(state));
    result = { ok: true, decision: d, headline: headline(state) };
  } else if (command === "quote") {
    let state = await loadState(projectId);
    const f = resolveFinding(state, sub);
    const accept = rest[0] === "accept";
    if (!["accept", "reject"].includes(rest[0] ?? "")) fail("quote <finding> accept|reject");
    state = await apply(state, (s) => confirmQuote(s, f.id, accept));
    say(headline(state));
    result = { ok: true, decision: state.control.decisions[f.id], adjustments: state.control.adjustments, tasks: state.control.tasks, headline: headline(state) };
  } else if (command === "config") {
    let state = await loadState(projectId);
    const flag = (v: unknown) => (v === "on" ? true : v === "off" ? false : undefined);
    const patch: Partial<V2State["control"]["reportConfig"]> = {};
    if (flag(opts.trends) !== undefined) patch.includeTrends = flag(opts.trends)!;
    if (flag(opts["by-building"]) !== undefined) patch.splitByBuilding = flag(opts["by-building"])!;
    if (opts.ceo !== undefined) patch.ceoVersion = !!opts.ceo;
    if (Object.keys(patch).length) state = await apply(state, (s) => setReportConfig(s, patch));
    if (opts.save) state = await apply(state, (s) => saveConfig(s, true));
    say(`תצורת הדוח: ${JSON.stringify(state.control.reportConfig)}`);
    result = { ok: true, reportConfig: state.control.reportConfig };
  } else if (command === "finalize") {
    let state = await loadState(projectId);
    state = await apply(state, finalizeControl);
    say(`✓ בקרה ${state.control.controlDate} נסגרה כגרסה סופית`);
    result = { ok: true };
  } else if (command === "report") {
    const state = await loadState(projectId);
    const report = buildReport(pkg, state);
    const tab = opts.ceo ? "ceo" : "full";
    const md = reportToMarkdown(report, tab);
    if (opts.md) {
      writeFileSync(String(opts.md), md, "utf8");
      say(`✓ Markdown נכתב: ${opts.md}`);
    } else if (!asJson) {
      say(md);
    }
    let docxPath: string | null = null;
    if (opts.docx) {
      const blob = await exportReportDocx(report, tab);
      writeFileSync(String(opts.docx), Buffer.from(await blob.arrayBuffer()));
      docxPath = String(opts.docx);
      say(`✓ Word נכתב: ${docxPath}`);
    }
    if (!opts["no-save"]) {
      const id = await saveReportVersion(projectId, state.control.controlDate, report, state.operatorId, (opts.label as string | undefined) ?? null, docxPath);
      say(`✓ גרסת דוח נשמרה במסד הנתונים (report_versions #${id})`);
    }
    result = { ok: true, tab, report, markdown: md, docxPath };
  } else {
    fail("פקודות: status · reset · erp … · control run|show · decide · route · quote · config · report · finalize · tools · tool <name> [json]");
  }

  if (asJson) console.log(JSON.stringify(result, null, 2));
  else console.log(out.join("\n"));
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
