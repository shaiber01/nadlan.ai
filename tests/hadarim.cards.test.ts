import { describe, expect, it } from "vitest";
import { FINDING_KINDS, checkAllocation, checkContractOverrun, checkCoverage, checkCumulative, checkDates, checkDocuments, checkDuplicates, checkOrderAllocation, checkPrices, checkRetention, checkReviewAging, checkUnits, type HFinding } from "../src/hadarim/engine/checks";
import { createInvoice, initialState, pkg, reviewFindings, revealAllSteps, setPackage, startControl, updateInvoiceSection, updatePurchaseOrderSection } from "../src/hadarim/engine/commands";
import type { V2State } from "../src/hadarim/engine/model";
import { raiseFinding } from "../src/hadarim/engine/operations";

// the revised BOQ page (boq_v5_ch57) processed, as the agent would before a control runs
setPackage({ ...pkg, documents: pkg.documents.map((d) => (d.id === "boq_v5_ch57" ? { ...d, facts: { removedLineIds: ["57.03.040"] }, factsSource: { method: "agent" as const, byId: "EYAL" as const } } : d)) });

/**
 * The finding cards as the agent presents them: every option says what choosing it does, so the question's
 * descriptions carry consequences and never the card's text again.
 */

type Invoice = V2State["erp"]["invoices"][number];
const patchInvoice = (s: V2State, id: number, patch: (i: Invoice) => Invoice): V2State => ({ ...s, erp: { ...s.erp, invoices: s.erp.invoices.map((i) => (i.id === id ? patch(i) : i)) } });
const other = (sectionId: string) => pkg.sections.find((x) => x.id !== sectionId && x.kind === "works")!.id;

/** One state, and one package, in which every check of the registry raises at least one finding. */
function everyKind(): HFinding[] {
  const seed = initialState();
  const draft = pkg.forecasts.find((f) => f.controlDate === seed.control.controlDate)!;
  const used = new Set<number>();
  const pick = (test: (i: Invoice) => boolean) => {
    const inv = seed.erp.invoices.find((i) => !used.has(i.id) && test(i))!;
    used.add(inv.id);
    return inv;
  };
  const onContract = pick((i) => !!i.contractId && pkg.contracts.find((c) => c.id === i.contractId)!.sectionId === i.sectionId);
  const withCumulative = pick((i) => i.cumulativeNow != null && i.cumulativePrev != null);
  const withRetention = pick((i) => i.retentionPct > 0 && !!i.contractId && i.docType === "חשבון חלקי");
  const dated = pick((i) => i.status === "אושר");
  const inReview = pick((i) => i.status === "בבדיקה");
  const withDoc = pick((i) => !!i.attachmentId && !!pkg.documents.find((d) => d.id === i.attachmentId)?.facts);
  let s = updateInvoiceSection(seed, onContract.id, other(onContract.sectionId) as never, "SARIT");
  const po = s.erp.purchaseOrders.find((p) => p.contractId && pkg.contracts.find((c) => c.id === p.contractId)!.sectionId === p.sectionId)!;
  s = updatePurchaseOrderSection(s, po.id, other(po.sectionId) as never, "EYAL");
  s = patchInvoice(s, withCumulative.id, (i) => ({ ...i, cumulativeNow: (i.cumulativeNow ?? 0) + 1000 }));
  s = patchInvoice(s, withRetention.id, (i) => ({ ...i, retentionAmt: i.retentionAmt + 7 }));
  s = patchInvoice(s, dated.id, (i) => ({ ...i, dateReceived: "2020-01-01" }));
  s = patchInvoice(s, inReview.id, (i) => ({ ...i, dateReceived: "2026-07-01" }));
  const original = seed.erp.invoices.find((i) => i.contractId && i.status === "אושר")!;
  s = createInvoice(s, { supplierId: original.supplierId, supplierDocNo: original.supplierDocNo, date: original.date, amount: original.amount, descriptionHe: original.descriptionHe, sectionId: original.sectionId, contractId: original.contractId, attachmentId: null, byId: "SARIT" })[0];
  const contract = pkg.contracts.find((c) => c.amount != null && !c.closed)!;
  const recorded = s.erp.invoices.filter((i) => i.contractId === contract.id && i.status !== "בבדיקה").reduce((a, i) => a + i.amount, 0);
  s = createInvoice(s, { supplierId: contract.supplierId, supplierDocNo: "OVER-1", date: "2026-08-28", amount: contract.amount! - recorded + 12_345, descriptionHe: "חשבון חלקי", sectionId: contract.sectionId, contractId: contract.id, attachmentId: null, byId: "SARIT" })[0];
  const doc = pkg.documents.find((d) => d.id === withDoc.attachmentId)!;
  const quotePo = s.erp.purchaseOrders.find((p) => p.attachmentId && pkg.documents.find((d) => d.id === p.attachmentId)?.facts)!;
  const quote = pkg.documents.find((d) => d.id === quotePo.attachmentId)!;
  const p = { ...pkg, documents: pkg.documents.map((d) => (d.id === doc.id ? { ...d, facts: { ...d.facts, amountThis: withDoc.amount + 5_000, cumulativeNow: (withDoc.cumulativePrev ?? 0) + withDoc.amount + 5_000 } } : d.id === quote.id ? { ...d, facts: { ...d.facts, amount: quotePo.amount + 900 } } : d)) };
  return [
    ...checkAllocation(pkg, s.erp),
    ...checkOrderAllocation(pkg, s.erp),
    ...checkUnits(pkg, s.erp),
    ...checkPrices(pkg, s.erp, draft, s.control.controlDate),
    ...checkCoverage(pkg, draft),
    ...checkDuplicates(pkg, s.erp),
    ...checkContractOverrun(pkg, s.erp),
    ...checkCumulative(pkg, s.erp),
    ...checkRetention(pkg, s.erp),
    ...checkDates(pkg, s.erp, "2026-09-03"),
    ...checkReviewAging(pkg, s.erp, s.control.controlDate),
    ...checkDocuments(p, s.erp),
  ];
}

describe("every option says what it does", () => {
  it("every option of every finding kind the checks raise carries a non-empty consequenceHe", () => {
    const findings = everyKind();
    const kinds = new Set(findings.map((f) => f.kind));
    for (const k of FINDING_KINDS) expect(kinds, `no finding of kind ${k}`).toContain(k);
    for (const f of findings) {
      expect(f.decision.options.length, f.id).toBeGreaterThan(0);
      for (const o of f.decision.options) {
        expect(o.consequenceHe, `${f.id} · ${o.id}`).toMatch(/\S/);
        // the consequence is one line, and it is not the card's text again
        expect(o.consequenceHe).not.toContain("\n");
        expect(o.consequenceHe).not.toBe(f.problemHe);
      }
    }
    // an update says it writes now; a referral names the person from the project's people; a closing option says the record stays
    const alloc = findings.find((f) => f.kind === "allocation" && f.record.type === "invoice")!;
    expect(alloc.decision.options.find((o) => o.id === "yes_target")!.consequenceHe).toMatch(/במערכת המידע מיד/);
    const accountant = pkg.people.find((x) => x.roleHe.includes("חשבונות"))!;
    expect(alloc.decision.options.find((o) => o.id === "yes_refer")!.consequenceHe).toContain(accountant.nameHe);
    expect(alloc.decision.options.find((o) => o.id === "no_stay")!.consequenceHe).toContain("הרשומה לא משתנה");
    expect(alloc.decision.options.find((o) => o.id === "unsure")!.consequenceHe).toContain("נשאר פתוח");
    const unit = findings.find((f) => f.kind === "unit")!;
    expect(unit.decision.options[0].consequenceHe).toMatch(/במערכת המידע מיד/);
    const price = findings.find((f) => f.kind === "price")!;
    expect(price.decision.options.find((o) => o.id === "all")!.consequenceHe).toContain("מערכת המידע לא משתנה");
    // no tool name or Latin fragment leaks into what the user reads
    for (const f of findings) for (const o of f.decision.options) expect(`${o.labelHe} ${o.consequenceHe}`).not.toMatch(/[A-Za-z_]{4,}/);
  });

  it("a raised finding's options carry consequences too — the engine's by id, or the agent's own line", () => {
    const seed = initialState();
    const inv = seed.erp.invoices.find((i) => !!i.contractId)!;
    const running = reviewFindings(revealAllSteps(startControl(seed, "בקרה")));
    const base = { titleHe: "א", problemHe: "ב", meaningHe: "ג", sectionId: inv.sectionId, record: { type: "invoice" as const, id: String(inv.id) } };
    const [, plain] = raiseFinding(running, { ...base, referToId: "ROI" });
    expect(plain.decision.options.map((o) => o.id)).toEqual(["refer", "accept"]);
    expect(plain.decision.options[0].consequenceHe).toContain(pkg.people.find((x) => x.id === "ROI")!.nameHe);
    expect(plain.decision.options[1].consequenceHe).toMatch(/\S/);
    const [, fixed] = raiseFinding(running, { ...base, proposedFix: { labelHe: "עכבון 0%", patch: { retentionPct: 0, retentionAmt: 0, netPayable: inv.amount } } });
    expect(fixed.decision.options[0]).toMatchObject({ id: "apply" });
    expect(fixed.decision.options[0].consequenceHe).toContain("עכבון 0%");
    const [, custom] = raiseFinding(running, { ...base, options: [{ id: "accept", labelHe: "תקין", consequenceHe: "סוגר בלי שינוי" }, { id: "refer", labelHe: "להעביר" }] });
    expect(custom.decision.options.map((o) => o.consequenceHe)).toEqual(["סוגר בלי שינוי", expect.stringContaining("פותח משימה")]);
  });
});
