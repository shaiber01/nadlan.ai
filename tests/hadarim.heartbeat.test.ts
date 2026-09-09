import { describe, expect, it } from "vitest";
import { STANDARD_CHECK_POLICY, type HDocument } from "../src/hadarim/data/types";
import { extractText, mimeTypeFor } from "../src/hadarim/documents/extract";
import { initialState, pkg, startControl, updateInvoiceSection, createInvoice, revealAllSteps, reviewFindings } from "../src/hadarim/engine/commands";
import { reportBlockers } from "../src/hadarim/engine/heartbeat";
import { changeLogId, groupChanges, heartbeatSummaryHe, heartbeatWork, isUnprocessed } from "../src/hadarim/engine/heartbeat";
import { tools } from "../src/hadarim/tools";

/**
 * Real documents and the heartbeat: what is new since the last pass is measured on the change log; pending
 * documents are the ones nobody recorded facts for; the checks' findings are reported once unless their
 * record changes again; text is extracted from real files by the Node tools.
 */

const firstInvoice = () => pkg.invoices.find((i) => i.status === "אושר" && i.contractId)!;
const otherSection = (s: string) => pkg.sections.find((x) => x.id !== s && x.kind === "works")!.id;

describe("heartbeat work from the change log", () => {
  it("starts empty above the watermark and lists the records changed since, with who and what", () => {
    const base = initialState();
    const top = base.erp.changeLog.reduce((m, e) => Math.max(m, changeLogId(e)), 0);
    const quiet = heartbeatWork(pkg, base, top);
    expect(quiet.changedRecords).toEqual([]);
    expect(quiet.untilChangeLogId).toBe(top);
    // unknown findings are reported on the first pass, and not on the next one once reported
    expect(quiet.findings.length).toBeGreaterThan(0);
    const again = heartbeatWork(pkg, base, top, quiet.findings.map((f) => f.id));
    expect(again.findings).toEqual([]);

    const inv = firstInvoice();
    const edited = updateInvoiceSection(base, inv.id, otherSection(inv.sectionId) as never, pkg.people[0].id);
    const work = heartbeatWork(pkg, edited, top, quiet.findings.map((f) => f.id));
    expect(work.changedRecords).toHaveLength(1);
    expect(work.changedRecords[0]).toMatchObject({ type: "invoice", id: String(inv.id), isNew: false, byIds: [pkg.people[0].id] });
    expect(work.changedRecords[0].fieldsHe).toContain("סעיף תקציבי");
    expect(work.untilChangeLogId).toBeGreaterThan(top);
    // a finding on the changed record is reported even though it was reported before
    const onRecord = work.findings.filter((f) => f.record.type === "invoice" && f.record.id === String(inv.id));
    expect(onRecord.length).toBeGreaterThan(0);
    expect(heartbeatSummaryHe(work)).toContain("1 רשומות השתנו");
  });

  it("marks inserted records as new and groups several changes of one record", () => {
    const base = initialState();
    const top = base.erp.changeLog.reduce((m, e) => Math.max(m, changeLogId(e)), 0);
    const supplier = pkg.suppliers[0];
    const [withNew, created] = createInvoice(base, { supplierId: supplier.id, supplierDocNo: "HB-1", date: base.clock.slice(0, 10), amount: 1000, descriptionHe: "בדיקה", sectionId: pkg.sections.find((s) => s.kind === "works")!.id, contractId: null, attachmentId: null, byId: pkg.people[0].id });
    const then = updateInvoiceSection(withNew, created.id, otherSection(created.sectionId) as never, pkg.people[1].id);
    const work = heartbeatWork(pkg, then, top, []);
    const rec = work.changedRecords.find((r) => r.id === String(created.id))!;
    expect(rec.isNew).toBe(true);
    expect(rec.entries.length).toBe(2);
    expect(rec.byIds).toEqual([pkg.people[0].id, pkg.people[1].id]);
    expect(groupChanges(then.erp.changeLog.slice(-2)).length).toBe(1);
  });

  it("does not report findings the session already holds, and lists the session's undecided ones for context", () => {
    const running = reviewFindings(revealAllSteps(startControl(initialState(), "בקרה")));
    const top = running.erp.changeLog.reduce((m, e) => Math.max(m, changeLogId(e)), 0);
    const work = heartbeatWork(pkg, running, top);
    expect(work.findings).toEqual([]);
    expect(work.sessionOpenFindings.length).toBe(running.control.findings.length);
  });

  it("pending documents are those without recorded facts", () => {
    const seedDoc = pkg.documents.find((d) => d.factsSource)!;
    expect(isUnprocessed(seedDoc)).toBe(false);
    const uploaded: HDocument = { id: "doc_0001", kind: "other", titleHe: "קובץ", date: "2026-09-09", supplierId: null, fileName: "x.pdf", blocks: [], footerHe: "", anchors: {}, filePath: "HADARIM/doc_0001/x.pdf" };
    expect(isUnprocessed(uploaded)).toBe(true);
    const work = heartbeatWork({ ...pkg, documents: [...pkg.documents, uploaded] }, initialState(), 0);
    expect(work.pendingDocuments.map((d) => d.id)).toEqual(expect.arrayContaining(["doc_0001"]));
    expect(STANDARD_CHECK_POLICY.reviewAgingDays).toBeGreaterThan(0);
  });
});

describe("the document and heartbeat tools", () => {
  it("are registered with the right kinds and filters", () => {
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.add_document.kind).toBe("write");
    expect(byName.classify_document.kind).toBe("write");
    expect(byName.get_heartbeat_work.kind).toBe("check");
    expect(byName.record_heartbeat.kind).toBe("write");
    expect(byName.list_heartbeats.kind).toBe("read");
    expect(Object.keys(byName.search_documents.input)).toEqual(expect.arrayContaining(["unprocessed", "recordType", "recordId"]));
    expect(Object.keys(byName.get_heartbeat_work.input)).toEqual(expect.arrayContaining(["sinceChangeLogId", "sinceDate", "extract"]));
  });

  it("the agent gets the new tools and the heartbeat skill exists", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const agent = readFileSync(".claude/agents/bakara.md", "utf8");
    for (const t of ["add_document", "classify_document", "get_heartbeat_work", "record_heartbeat", "list_heartbeats"]) expect(agent).toContain(`mcp__bakara__${t}`);
    expect(agent).not.toContain("mcp__bakara__ask_person");
    // decisions are asked with clickable options; the control skill routes every card through it
    expect(agent.split("\n")[3]).toContain("AskUserQuestion");
    expect(agent).toContain("## Hebrew only");
    expect(readFileSync(".claude/skills/bakara-control/SKILL.md", "utf8")).toContain("AskUserQuestion");
    expect(existsSync(".claude/skills/bakara-heartbeat/SKILL.md")).toBe(true);
    expect(readFileSync(".claude/skills/bakara-report/SKILL.md", "utf8")).toContain("/bakara-heartbeat");
  });
});

/** A one-page PDF with Latin text, built by hand (pdf.js reconstructs the cross-reference table). */
function tinyPdf(text: string): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 14 Tf 50 780 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe("text extraction from real files", () => {
  it("reads a PDF's text with pdf.js, decodes text files, yields nothing for images", async () => {
    const pdf = await extractText(tinyPdf("Quote 8834 - 120 ton at 4800 per ton"), "application/pdf");
    expect(pdf.method).toBe("pdfjs");
    expect(pdf.pages).toBe(1);
    expect(pdf.text).toContain("Quote 8834");
    const txt = await extractText(new TextEncoder().encode("הצעת מחיר 8834\n120 טון"), "text/plain");
    expect(txt).toEqual({ text: "הצעת מחיר 8834\n120 טון", pages: null, method: "text" });
    expect(await extractText(new Uint8Array([137, 80, 78, 71]), "image/png")).toMatchObject({ text: null, method: "none" });
    expect(await extractText(new TextEncoder().encode("not a pdf"), "application/pdf")).toMatchObject({ text: null, method: "none" });
    expect(mimeTypeFor("quote.PDF")).toBe("application/pdf");
    expect(mimeTypeFor("scan.jpeg", "application/octet-stream")).toBe("image/jpeg");
  });
});

describe("reportBlockers — a saved version or a final control must rest on data that was read", () => {
  const other = (id: string) => pkg.sections.find((s) => s.id !== id)!.id;
  const lastLogId = (s: ReturnType<typeof initialState>) => Math.max(0, ...s.erp.changeLog.map((c) => Number(c.id.replace(/\D/g, ""))));
  // the seed's own pending document (boq_v5_ch57) processed, so these cases can reason about an otherwise-clean folder
  const processedPkg = { ...pkg, documents: pkg.documents.map((d) => (isUnprocessed(d) ? { ...d, facts: {}, factsSource: { method: "agent" as const, byId: "EYAL" as const } } : d)) };

  it("nothing blocks a project whose heartbeat covers the change log and whose folder has no pending document", () => {
    const s = initialState();
    expect(reportBlockers(processedPkg, s, { untilChangeLogId: lastLogId(s) }, lastLogId(s))).toEqual([]);
    expect(reportBlockers(processedPkg, s, null, 0)).toEqual([]);
  });

  it("a pending document blocks; a project with changes and no heartbeat blocks", () => {
    const s = initialState();
    const pendingDoc = { ...pkg.documents[0], id: "upload_1", fileName: "scan.pdf", facts: undefined, factsSource: undefined };
    const p = { ...processedPkg, documents: [...processedPkg.documents, pendingDoc] };
    const [b] = reportBlockers(p, s, { untilChangeLogId: lastLogId(s) }, lastLogId(s));
    expect(b).toMatchObject({ kind: "pending_documents" });
    expect(b.textHe).toContain("scan.pdf");
    expect(reportBlockers(processedPkg, s, null, lastLogId(s)).map((x) => x.kind)).toEqual(["no_heartbeat"]);
  });

  it("changes since the last heartbeat block only when the checks raise findings on them that nobody presented", () => {
    const seed = initialState();
    const inv = seed.erp.invoices.find((i) => i.contractId && pkg.contracts.find((c) => c.id === i.contractId)!.sectionId === i.sectionId)!;
    const moved = updateInvoiceSection(seed, inv.id, other(inv.sectionId) as never, "SARIT");
    const since = lastLogId(seed);
    const [b] = reportBlockers(processedPkg, moved, { untilChangeLogId: since }, lastLogId(moved));
    expect(b).toMatchObject({ kind: "unreviewed_findings" });
    expect(b.textHe).toContain(`F-ALLOC-${inv.id}`);
    // findings not tied to the change (the seed's own open findings) do not block: they are the control's business
    expect(b.textHe).not.toContain("F-UNIT");
    // once a heartbeat covered the change, nothing blocks
    expect(reportBlockers(processedPkg, moved, { untilChangeLogId: lastLogId(moved) }, lastLogId(moved))).toEqual([]);
    // a change that raises nothing does not block either: the invoice moved back to where it belongs
    const back = updateInvoiceSection(moved, inv.id, inv.sectionId, "SARIT");
    expect(reportBlockers(processedPkg, back, { untilChangeLogId: since }, lastLogId(back))).toEqual([]);
  });
});
