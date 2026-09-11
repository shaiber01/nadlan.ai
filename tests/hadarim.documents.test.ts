import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { HDocument, HadarimPackage } from "../src/hadarim/data/types";
import { DATA_QUALITY_KINDS, boqPageFor, checkDocuments, compareDocument, documentRecord, findQuoteFor, recordDocuments, runChecks, type InvoiceFixPatch } from "../src/hadarim/engine/checks";
import { initialState, pkg, updateInvoiceFields } from "../src/hadarim/engine/commands";
import { isUnprocessed } from "../src/hadarim/engine/heartbeat";
import { documentAsText, documentDownload } from "../src/hadarim/documents/download";
import { tools } from "../src/hadarim/tools";

/**
 * The document consistency check: a record against the facts recorded from its source document. The seed is
 * consistent; a mismatch becomes a card whose proposed fix is the document's values with the dependent fields
 * recomputed; what cannot be fixed by a field write (supplier, quantities) is referred.
 */

const seedState = () => initialState();
const invoiceWithDoc = () => seedState().erp.invoices.find((i) => i.attachmentId && pkg.documents.find((d) => d.id === i.attachmentId)?.facts)!;
const withDoc = (doc: HDocument): HadarimPackage => ({ ...pkg, documents: [...pkg.documents.filter((d) => d.id !== doc.id), doc] });

describe("compareDocument — the record against its document, the way the cards show it", () => {
  it("lists a record's documents: attachment, linked files, and a contract's excerpt and price appendices", () => {
    const state = seedState();
    const inv = invoiceWithDoc();
    expect(recordDocuments(pkg, state.erp, { type: "invoice", id: String(inv.id) }).map((d) => d.id)).toEqual([inv.attachmentId]);
    const framework = pkg.contracts.find((c) => c.priceAppendices?.length)!;
    const ids = recordDocuments(pkg, state.erp, { type: "contract", id: framework.id }).map((d) => d.id);
    for (const a of framework.priceAppendices!) expect(ids).toContain(a.documentId);
    const excerpt = pkg.contracts.find((c) => c.documentId)!;
    expect(recordDocuments(pkg, state.erp, { type: "contract", id: excerpt.id }).map((d) => d.id)).toContain(excerpt.documentId);
  });

  it("a document knows its record: the invoice or order that attaches it, the contract whose excerpt or appendix it is; a free page has none", () => {
    const state = seedState();
    const inv = invoiceWithDoc();
    expect(documentRecord(pkg, state.erp, pkg.documents.find((d) => d.id === inv.attachmentId)!)).toEqual({ type: "invoice", id: String(inv.id) });
    const po = state.erp.purchaseOrders.find((p) => p.attachmentId)!;
    expect(documentRecord(pkg, state.erp, pkg.documents.find((d) => d.id === po.attachmentId)!)).toEqual({ type: "po", id: String(po.id) });
    const framework = pkg.contracts.find((c) => c.priceAppendices?.length)!;
    expect(documentRecord(pkg, state.erp, pkg.documents.find((d) => d.id === framework.priceAppendices![0].documentId)!)).toEqual({ type: "contract", id: framework.id });
    const boqPage = pkg.documents.find((d) => d.kind === "boq_page")!;
    expect(documentRecord(pkg, state.erp, boqPage)).toBeNull();
  });

  it("a replaced document is history: not pending, not compared; the document that replaced it stands for the record", () => {
    const state = seedState();
    const po = state.erp.purchaseOrders.find((p) => p.attachmentId && pkg.documents.find((d) => d.id === p.attachmentId)?.facts)!;
    const old = pkg.documents.find((d) => d.id === po.attachmentId)!;
    const fresh: HDocument = { ...old, id: "upload_9", fileName: "quote_v2.pdf", filePath: "HADARIM/upload_9/quote_v2.pdf", recordRef: { type: "po", id: String(po.id) }, facts: undefined, factsSource: undefined };
    const replaced: HDocument = { ...old, supersededBy: "upload_9" };
    const p: HadarimPackage = { ...pkg, documents: [...pkg.documents.filter((d) => d.id !== old.id), replaced, fresh] };
    const record = { type: "po" as const, id: String(po.id) };
    expect(recordDocuments(p, state.erp, record).map((d) => d.id)).toEqual(["upload_9"]);
    expect(isUnprocessed(replaced)).toBe(false);
    expect(isUnprocessed(fresh)).toBe(true);
    // the old facts no longer feed the check; once the new document is read, its facts do
    expect(checkDocuments(p, state.erp, { poId: po.id })).toEqual([]);
    const read: HadarimPackage = { ...p, documents: p.documents.map((d) => (d.id === "upload_9" ? { ...d, facts: { amount: po.amount + 1_000, supplierId: po.supplierId }, factsSource: { method: "agent" as const, byId: "EYAL" } } : d)) };
    const [f] = checkDocuments(read, state.erp, { poId: po.id });
    expect(f.sources.some((s) => s.kind === "document" && s.refId === "upload_9")).toBe(true);
    expect(f.sources.some((s) => s.kind === "document" && s.refId === old.id)).toBe(false);
  });

  it("a replaced BOQ page or quote (from the folder, no record) is history too: the line's page and quote are the current documents", () => {
    const page = pkg.documents.find((d) => d.kind === "boq_page" && d.facts?.boqLineId)!;
    const lineId = String(page.facts!.boqLineId);
    const line = pkg.boq.find((l) => l.id === lineId)!;
    const quote = findQuoteFor(pkg, line)!;
    expect(boqPageFor(pkg, lineId)?.id).toBe(page.id);
    const newPage: HDocument = { ...page, id: "upload_10", fileName: "boq_v5.pdf", filePath: "HADARIM/upload_10/boq_v5.pdf", blocks: [], facts: undefined, factsSource: undefined };
    const newQuote: HDocument = { ...quote, id: "upload_11", fileName: "quote_v2.pdf", filePath: "HADARIM/upload_11/quote_v2.pdf", blocks: [], facts: undefined, factsSource: undefined };
    const p: HadarimPackage = { ...pkg, documents: [...pkg.documents.filter((d) => d.id !== page.id && d.id !== quote.id), { ...page, supersededBy: "upload_10" }, { ...quote, supersededBy: "upload_11" }, newPage, newQuote] };
    // unread replacements: the old pages no longer answer, and the new ones carry no facts yet
    expect(boqPageFor(p, lineId)).toBeUndefined();
    expect(findQuoteFor(p, line)?.id).not.toBe(quote.id);
    // once read, the replacements are the sources
    const read: HadarimPackage = { ...p, documents: p.documents.map((d) => (d.id === "upload_10" ? { ...d, facts: { boqLineId: lineId }, factsSource: { method: "agent" as const } } : d.id === "upload_11" ? { ...d, facts: { ...quote.facts }, factsSource: { method: "agent" as const } } : d)) };
    expect(boqPageFor(read, lineId)?.id).toBe("upload_10");
    expect(findQuoteFor(read, line)?.id).toBe("upload_11");
  });

  it("every compared fact of the seed invoice matches, with Hebrew labels; the rows the document check reads are exactly its mismatches", () => {
    const state = seedState();
    const inv = invoiceWithDoc();
    const doc = pkg.documents.find((d) => d.id === inv.attachmentId)!;
    const rows = compareDocument(pkg, state.erp, { type: "invoice", id: String(inv.id) }, doc);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.check === "document").every((r) => r.match === true)).toBe(true);
    expect(rows.every((r) => /^[^a-zA-Z]*$/.test(r.fieldHe))).toBe(true);
    // a changed amount: the compare marks it, and the check's details table carries the same row
    const p = withDoc({ ...doc, facts: { ...doc.facts, amountThis: inv.amount + 5_000, cumulativeNow: (inv.cumulativePrev ?? 0) + inv.amount + 5_000 } });
    const changed = compareDocument(p, state.erp, { type: "invoice", id: String(inv.id) }, p.documents.find((d) => d.id === doc.id)!);
    const mismatches = changed.filter((r) => r.check === "document" && r.match === false);
    expect(mismatches.map((r) => r.key).sort()).toEqual(["amount", "cumulativeNow"]);
    const [f] = checkDocuments(p, state.erp, { invoiceId: inv.id });
    expect(f.detailsTable!.slice(1).map((r) => [r[0], r[1], r[2]])).toEqual(mismatches.map((r) => [r.fieldHe, r.recordHe, r.docHe]));
  });

  it("an order's quote: amount and supplier for the document check, the line for the unit check — the seed's mis-keyed order shows the line as a mismatch", () => {
    const state = seedState();
    const po = state.erp.purchaseOrders.find((p) => p.attachmentId && pkg.documents.find((d) => d.id === p.attachmentId)?.facts)!;
    const doc = pkg.documents.find((d) => d.id === po.attachmentId)!;
    const rows = compareDocument(pkg, state.erp, { type: "po", id: String(po.id) }, doc);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.amount).toMatchObject({ check: "document", match: true });
    expect(byKey.supplierId).toMatchObject({ check: "document", match: true });
    expect(byKey.line_qty.check).toBe("unit");
    expect(byKey.line_price.check).toBe("unit");
    // the seed keys the order in the wrong unit on purpose: the unit check raises it, and the compare shows the same
    const unitFinding = runChecks(pkg, state.erp, pkg.forecasts.find((f) => f.controlDate === state.control.controlDate && f.sections)!, state.control.controlDate).findings.find((f) => f.kind === "unit" && f.record.id === String(po.id));
    expect(!!unitFinding).toBe(byKey.line_qty.match === false || byKey.line_price.match === false);
    expect(checkDocuments(pkg, state.erp, { poId: po.id })).toEqual([]);
  });

  it("a contract's appendix facts are compared with the appendix on the contract; an excerpt's exclusion clause with the contract's exclusions", () => {
    const state = seedState();
    const framework = pkg.contracts.find((c) => c.priceAppendices?.length)!;
    for (const a of framework.priceAppendices!) {
      const doc = pkg.documents.find((d) => d.id === a.documentId)!;
      const rows = compareDocument(pkg, state.erp, { type: "contract", id: framework.id }, doc);
      const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
      if (byKey.pricePerTon) expect(byKey.pricePerTon).toMatchObject({ match: true, check: null });
      if (byKey.validFrom) expect(byKey.validFrom.match).toBe(true);
    }
    const withExcerpt = pkg.contracts.find((c) => c.documentId && pkg.documents.find((d) => d.id === c.documentId)?.facts?.exclusionClause)!;
    const rows = compareDocument(pkg, state.erp, { type: "contract", id: withExcerpt.id }, pkg.documents.find((d) => d.id === withExcerpt.documentId)!);
    expect(rows.find((r) => r.key === "exclusionClause")).toMatchObject({ match: true });
    expect(rows.find((r) => r.key === "contractId")).toMatchObject({ match: true, recordHe: withExcerpt.id });
  });
});

describe("downloading a document", () => {
  it("a stored file downloads by its public URL under its own name; a seed page downloads as text with its blocks and tables", () => {
    const seed = pkg.documents.find((d) => d.blocks.some((b) => b.kind === "table"))!;
    const d = documentDownload(seed);
    expect(d.url).toBeUndefined();
    expect(d.fileName).toMatch(/\.txt$/);
    const text = documentAsText(seed);
    expect(text.startsWith(seed.titleHe)).toBe(true);
    const table = seed.blocks.find((b) => b.kind === "table")!;
    expect(text).toContain(table.rows![0].join("\t"));
    const stored: HDocument = { ...seed, id: "upload_1", fileName: "scan.pdf", filePath: "HADARIM/upload_1/scan.pdf" };
    const s = documentDownload(stored);
    expect(s.fileName).toBe("scan.pdf");
    expect(s.url).toContain("HADARIM/upload_1/scan.pdf");
  });
});

describe("checkDocuments", () => {
  it("is part of the data-quality checks and raises nothing on the consistent seed", () => {
    expect(DATA_QUALITY_KINDS).toContain("document");
    const state = seedState();
    expect(checkDocuments(pkg, state.erp)).toEqual([]);
    expect(runChecks(pkg, state.erp, pkg.forecasts.find((f) => f.controlDate === state.control.controlDate && f.sections)!, state.control.controlDate).findings.some((f) => f.kind === "document")).toBe(false);
  });

  it("an amount that differs from the invoice document gets a card with the document's values as the proposed fix, retention and cumulative recomputed", () => {
    const state = seedState();
    const inv = invoiceWithDoc();
    const doc = pkg.documents.find((d) => d.id === inv.attachmentId)!;
    const p = withDoc({ ...doc, facts: { ...doc.facts, amountThis: inv.amount + 5_000, cumulativeNow: (inv.cumulativePrev ?? 0) + inv.amount + 5_000 } });
    const [f] = checkDocuments(p, state.erp, { invoiceId: inv.id });
    expect(f).toBeTruthy();
    expect(f.id).toBe(`F-DOC-${inv.id}`);
    expect(f.kind).toBe("document");
    expect(f.record).toEqual({ type: "invoice", id: String(inv.id) });
    expect(f.impact).toMatchObject({ kind: "amount", amount: 5_000 });
    expect(f.sources.some((s) => s.kind === "document" && s.documentId === doc.id)).toBe(true);
    expect(f.decision.options.map((o) => o.id)).toEqual(["apply", "refer", "accept"]);
    const patch = f.proposedFix!.patch as InvoiceFixPatch; // a document card patches the invoice's fields
    expect(patch.amount).toBe(inv.amount + 5_000);
    expect(patch.retentionAmt).toBe(Math.round(((inv.amount + 5_000) * inv.retentionPct) / 100));
    expect(patch.netPayable).toBe(inv.amount + 5_000 - patch.retentionAmt!);
    // applying the fix keeps the invoice's arithmetic and logs the amount
    const fixed = updateInvoiceFields(state, inv.id, patch, pkg.people[0].id);
    const after = fixed.erp.invoices.find((i) => i.id === inv.id)!;
    expect(after.amount).toBe(inv.amount + 5_000);
    expect(after.netPayable).toBe(after.amount - after.retentionAmt);
    expect(fixed.erp.changeLog.at(-1)!.field === "סכום" || fixed.erp.changeLog.some((c) => c.field === "סכום")).toBe(true);
    expect(checkDocuments(p, fixed.erp, { invoiceId: inv.id })).toEqual([]);
  });

  it("supplier document number and date are fixable; a different supplier or quantity is referred without a proposed fix", () => {
    const state = seedState();
    const inv = invoiceWithDoc();
    const doc = pkg.documents.find((d) => d.id === inv.attachmentId)!;
    const [f1] = checkDocuments(withDoc({ ...doc, facts: { supplierDocNo: `${inv.supplierDocNo}-X`, date: inv.date } }), state.erp, { invoiceId: inv.id });
    expect(f1.proposedFix?.patch).toEqual({ supplierDocNo: `${inv.supplierDocNo}-X` });
    expect(f1.detailsTable![1][0]).toBe("מס׳ מסמך ספק");
    const other = pkg.suppliers.find((s) => s.id !== inv.supplierId)!;
    const [f2] = checkDocuments(withDoc({ ...doc, facts: { supplierId: other.id } }), state.erp, { invoiceId: inv.id });
    expect(f2.proposedFix).toBeUndefined();
    expect(f2.decision.options.map((o) => o.id)).toEqual(["refer", "accept"]);
    expect(f2.problemHe).toContain(other.nameHe);
  });

  it("documents linked by their own record reference are checked too, and an order's amount against its quote", () => {
    const state = seedState();
    const inv = state.erp.invoices.find((i) => !i.attachmentId)!;
    const uploaded: HDocument = { id: "doc_0009", kind: "invoice", titleHe: "חשבון סרוק", date: inv.date, supplierId: inv.supplierId, fileName: "scan.pdf", blocks: [], footerHe: "", anchors: {}, filePath: "HADARIM/doc_0009/scan.pdf", recordRef: { type: "invoice", id: String(inv.id) }, facts: { amount: inv.amount + 1 }, factsSource: { method: "agent" } };
    const [f] = checkDocuments({ ...pkg, documents: [...pkg.documents, uploaded] }, state.erp, { invoiceId: inv.id });
    expect(f?.id).toBe(`F-DOC-${inv.id}`);
    const po = state.erp.purchaseOrders.find((p) => p.attachmentId && pkg.documents.find((d) => d.id === p.attachmentId)?.facts)!;
    const quote = pkg.documents.find((d) => d.id === po.attachmentId)!;
    expect(checkDocuments(pkg, state.erp, { poId: po.id })).toEqual([]);
    const [fp] = checkDocuments(withDoc({ ...quote, facts: { ...quote.facts, amount: po.amount + 900 } }), state.erp, { poId: po.id });
    expect(fp.id).toBe(`F-DOC-PO-${po.id}`);
    expect(fp.proposedFix).toBeUndefined();
    expect(fp.impact.amount).toBe(900);
  });

  it("run_check accepts kind document", () => {
    const schema = z.object(tools.find((t) => t.name === "run_check")!.input);
    expect(schema.parse({ kind: "document", invoiceId: 1 }).kind).toBe("document");
  });
});
