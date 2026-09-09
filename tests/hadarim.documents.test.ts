import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { HDocument, HadarimPackage } from "../src/hadarim/data/types";
import { DATA_QUALITY_KINDS, checkDocuments, runChecks, type InvoiceFixPatch } from "../src/hadarim/engine/checks";
import { initialState, pkg, updateInvoiceFields } from "../src/hadarim/engine/commands";
import { tools } from "../src/hadarim/tools";

/**
 * The document consistency check: a record against the facts recorded from its source document. The seed is
 * consistent; a mismatch becomes a card whose proposed fix is the document's values with the dependent fields
 * recomputed; what cannot be fixed by a field write (supplier, quantities) is referred.
 */

const seedState = () => initialState();
const invoiceWithDoc = () => seedState().erp.invoices.find((i) => i.attachmentId && pkg.documents.find((d) => d.id === i.attachmentId)?.facts)!;
const withDoc = (doc: HDocument): HadarimPackage => ({ ...pkg, documents: [...pkg.documents.filter((d) => d.id !== doc.id), doc] });

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
