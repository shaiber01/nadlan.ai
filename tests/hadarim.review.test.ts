import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkUnits, findQuoteFor, quoteFacts, sectionShort } from "../src/hadarim/engine/checks";
import { decide, initialState, pkg, reviewFindings, revealAllSteps, startControl, updateInvoiceSection, updatePurchaseOrderSection } from "../src/hadarim/engine/commands";
import type { V2State } from "../src/hadarim/engine/model";
import { raiseFinding, recordReviewPass } from "../src/hadarim/engine/operations";
import { buildReport } from "../src/hadarim/engine/report";
import { tools } from "../src/hadarim/tools";

/**
 * The agent's review in the loop: findings it raises from reading take the same card, decisions and
 * report path as the checks' findings; the review pass is stated in the report; facts recorded from a
 * document drive the deterministic checks.
 */

function running(): V2State {
  return reviewFindings(revealAllSteps(startControl(updateInvoiceSection(initialState(), 1147, "02", "SARIT"), "בקרה")));
}

describe("findings raised by the agent", () => {
  it("need a running control, enter the session with people and reasoning, and are listed in the report", () => {
    expect(() => raiseFinding(initialState(), { titleHe: "x", problemHe: "y", meaningHe: "z", sectionId: "07", record: { type: "invoice", id: "1147" } })).toThrow(/run_control/);
    const state = running();
    const [s, f] = raiseFinding(state, { titleHe: "חשבון 1147 — התיאור אינו תואם להיקף החוזה", problemHe: "התיאור ״עבודות עפר וקווי ניקוז״ אינו כלול בהיקף חוזה 02-01 (שלד).", meaningHe: "ייתכן שיוך שגוי או עבודה ללא חוזה.", sectionId: "02", record: { type: "invoice", id: "1147" }, sources: [{ kind: "invoice", refId: "1147", labelHe: "חשבון 1147 — תיאור" }, { kind: "contract", refId: "02-01", labelHe: "חוזה 02-01 — היקף" }], reasoningHe: "קראתי את תיאור החשבון מול רשימת ההכללות של החוזה", referToId: "ROI" });
    expect(f.id).toBe("F-REV-1");
    expect(f).toMatchObject({ kind: "review", origin: "review", sectionId: "02", referToId: "ROI" });
    expect(f.people?.map((p) => p.id)).toEqual(expect.arrayContaining(["SARIT"]));
    expect(f.notesHe?.[0]).toContain("נימוק הסוכן");
    expect(f.decision.options.map((o) => o.id)).toEqual(["refer", "accept"]);
    expect(f.decision.options[0].labelHe).toContain("רועי");
    const r = buildReport(pkg, s);
    expect(r.openFindings.some((x) => x.id === "F-REV-1" && x.peopleHe.includes("שרית"))).toBe(true);
    expect(s.audit.at(-1)!.textHe).toContain("F-REV-1");
  });

  it("'refer' goes to the person named on the finding; 'accept' closes it; a proposed fix on an invoice can be applied", () => {
    const state = running();
    const [s1, f1] = raiseFinding(state, { titleHe: "א", problemHe: "ב", meaningHe: "ג", sectionId: "02", record: { type: "invoice", id: "1147" }, referToId: "ROI" });
    const referred = decide(s1, f1.id, "refer");
    expect(referred.control.decisions[f1.id]).toMatchObject({ status: "pending_execution", ownerId: "ROI" });
    expect(referred.control.tasks.at(-1)).toMatchObject({ ownerId: "ROI", findingId: f1.id });
    expect(referred.control.tasks.at(-1)!.titleHe).toContain("טיפול —");
    const accepted = decide(s1, f1.id, "accept", "נבדק מול הקבלן");
    expect(accepted.control.decisions[f1.id]).toMatchObject({ status: "handled" });
    const inv = state.erp.invoices.find((i) => i.id === 1147)!;
    const [s2, f2] = raiseFinding(state, { titleHe: "עכבון", problemHe: "ב", meaningHe: "ג", sectionId: "02", record: { type: "invoice", id: "1147" }, proposedFix: { labelHe: "עכבון 0%", patch: { retentionPct: 0, retentionAmt: 0, netPayable: inv.amount } } });
    expect(f2.decision.options[0].id).toBe("apply");
    const applied = decide(s2, f2.id, "apply");
    expect(applied.erp.invoices.find((i) => i.id === 1147)!.retentionAmt).toBe(0);
    expect(applied.control.corrections.at(-1)).toMatchObject({ recordId: "1147", findingId: f2.id });
  });

  it("a review finding may carry a section move or an order fix that names stored data; 'apply' runs the guarded path, 'refer' when the operator may not", () => {
    const state = running();
    const other = (id: string) => pkg.sections.find((s) => s.id !== id)!.id;
    const base = { titleHe: "א", problemHe: "ב", meaningHe: "ג" };
    // an invoice the agent read as belonging to its contract's section
    const inv = state.erp.invoices.find((i) => i.contractId && i.id !== 1147 && pkg.contracts.find((c) => c.id === i.contractId)!.sectionId === i.sectionId)!;
    const wrong = other(inv.sectionId);
    const [s1, f1] = raiseFinding(updateInvoiceSection(state, inv.id, wrong, "SARIT"), { ...base, sectionId: wrong, record: { type: "invoice", id: String(inv.id) }, proposedFix: { labelHe: `שיוך ל${sectionShort(inv.sectionId)}`, patch: { sectionId: inv.sectionId } } });
    expect(f1.decision.options[0].id).toBe("apply");
    const applied = decide(s1, f1.id, "apply");
    expect(applied.erp.invoices.find((i) => i.id === inv.id)!.sectionId).toBe(inv.sectionId);
    expect(applied.control.decisions[f1.id]).toMatchObject({ status: "handled", routeId: "update" });
    expect(applied.control.decisions[f1.id].verifiedHe).toContain(`חשבון ${inv.id}`);
    expect(applied.control.corrections.at(-1)).toMatchObject({ recordType: "invoice", recordId: String(inv.id), fieldHe: "סעיף תקציבי", findingId: f1.id, status: "applied" });
    expect(applied.control.corrections.at(-1)!.crossSectionHe).toContain(`${inv.sectionId}-`);
    expect(applied.erp.changeLog.at(-1)).toMatchObject({ recordType: "invoice", recordId: String(inv.id), field: "סעיף תקציבי", byId: s1.operatorId });
    expect(applied.audit.at(-1)!.textHe).toContain(`חשבון ${inv.id}`);
    // an operator without the allocation permission gets a task instead of a write
    const noPermission = decide({ ...s1, operatorId: pkg.people.find((p) => !p.canWriteAllocation)!.id }, f1.id, "apply");
    expect(noPermission.erp.invoices.find((i) => i.id === inv.id)!.sectionId).toBe(wrong);
    expect(noPermission.control.decisions[f1.id].status).toBe("pending_execution");
    expect(noPermission.control.tasks.at(-1)).toMatchObject({ findingId: f1.id, status: "pending_execution" });
    // an order: its section back to the contract's, on approval
    const po = state.erp.purchaseOrders.find((p) => p.status === "פתוחה")!;
    const poWrong = other(po.sectionId);
    const [s2, f2] = raiseFinding(updatePurchaseOrderSection(state, po.id, poWrong, "EYAL"), { ...base, sectionId: poWrong, record: { type: "po", id: String(po.id) }, proposedFix: { labelHe: `שיוך ל${sectionShort(po.sectionId)}`, patch: { sectionId: po.sectionId } } });
    const applied2 = decide(s2, f2.id, "apply");
    const fixed = applied2.erp.purchaseOrders.find((p) => p.id === po.id)!;
    expect([fixed.sectionId, fixed.qty, fixed.amount]).toEqual([po.sectionId, po.qty, po.amount]);
    expect(applied2.control.corrections.at(-1)).toMatchObject({ recordType: "po", recordId: String(po.id), fieldHe: "סעיף תקציבי", findingId: f2.id, status: "applied" });
    expect(applied2.control.decisions[f2.id].verifiedHe).toContain(`הזמנה ${po.id}`);
    // an order's line under the amount lock: the same order stated per ton in kilograms keeps 57,600 — here a no-op restatement in its own units
    const [s3, f3] = raiseFinding(state, { ...base, sectionId: po.sectionId, record: { type: "po", id: String(po.id) }, proposedFix: { labelHe: "אותה שורה", patch: { qty: po.qty, unit: po.unit, priceUnit: po.priceUnit, unitPrice: po.unitPrice } } });
    expect(decide(s3, f3.id, "apply").erp.purchaseOrders.find((p) => p.id === po.id)!.amount).toBe(po.amount);
    // refused when raised: a line that breaks the amount, a field the record does not have, a section that does not exist, an empty fix
    expect(() => raiseFinding(state, { ...base, sectionId: po.sectionId, record: { type: "po", id: String(po.id) }, proposedFix: { labelHe: "x", patch: { qty: po.qty * 2 } } })).toThrow(/סכום ההזמנה/);
    expect(() => raiseFinding(state, { ...base, sectionId: "02", record: { type: "invoice", id: "1147" }, proposedFix: { labelHe: "x", patch: { qty: 1 } as never } })).toThrow(/שדות/);
    expect(() => raiseFinding(state, { ...base, sectionId: "02", record: { type: "invoice", id: "1147" }, proposedFix: { labelHe: "x", patch: { sectionId: "99" as never } } })).toThrow(/סעיף 99/);
    expect(() => raiseFinding(state, { ...base, sectionId: "02", record: { type: "invoice", id: "1147" }, proposedFix: { labelHe: "x", patch: {} } })).toThrow(/ריק/);
    expect(() => raiseFinding(state, { ...base, sectionId: "02", record: { type: "invoice", id: "1147" }, proposedFix: { labelHe: "x", patch: { retentionPct: 5, retentionAmt: 1, netPayable: 1 } } })).toThrow(/העכבון/);
    // the tool schema accepts the section move and the order line
    const schema = z.object(tools.find((t) => t.name === "raise_finding")!.input);
    expect(schema.parse({ titleHe: "א", problemHe: "ב", meaningHe: "ג", sectionId: "03", record: { type: "po", id: "2291" }, proposedFix: { labelHe: "x", patch: { sectionId: "03", qty: 12, unit: "טון" } } }).proposedFix!.patch.sectionId).toBe("03");
  });

  it("raising a finding after all cards were handled reopens the control; invalid records and people are rejected", () => {
    const state = { ...running(), control: { ...running().control, status: "report" as const } };
    const [s] = raiseFinding(state, { titleHe: "א", problemHe: "ב", meaningHe: "ג", sectionId: "07", record: { type: "contract", id: "07-01" } });
    expect(s.control.status).toBe("reviewing");
    expect(() => raiseFinding(state, { titleHe: "א", problemHe: "ב", meaningHe: "ג", sectionId: "07", record: { type: "invoice", id: "999999" } })).toThrow(/לא נמצאה/);
    expect(() => raiseFinding(state, { titleHe: "א", problemHe: "ב", meaningHe: "ג", sectionId: "07", record: { type: "contract", id: "07-01" }, referToId: "NOBODY" })).toThrow(/NOBODY/);
    expect(() => raiseFinding(state, { titleHe: "א", problemHe: "ב", meaningHe: "ג", sectionId: "07", record: { type: "contract", id: "07-01" }, proposedFix: { labelHe: "x", patch: {} } })).toThrow(/רק על חשבון/);
  });
});

describe("the review pass", () => {
  it("is stated in the report once recorded, and only the latest summary is kept", () => {
    const state = running();
    expect(buildReport(pkg, state).header.reviewPassHe).toBeNull();
    expect(buildReport(pkg, state).header.sourcesHe).toContain("סקירת הסוכן טרם בוצעה");
    const [s1] = recordReviewPass(state, "נקראו 24 חשבונות מול 11 חוזים; ממצא אחד");
    const [s2] = recordReviewPass(s1, "סקירה שנייה");
    expect(s2.control.notes.filter((n) => n.kind === "review_pass")).toHaveLength(1);
    const r = buildReport(pkg, s2);
    expect(r.header.reviewPassHe).toContain("סקירה שנייה");
    expect(r.header.sourcesHe).toContain("סקירת הסוכן בוצעה");
    expect(() => recordReviewPass(state, "  ")).toThrow();
  });
});

describe("facts recorded from a document drive the checks", () => {
  it("a quote pointed at a BOQ line by its facts is found for that line; facts on an order's quote decide the unit check", () => {
    const line = pkg.boq.find((l) => l.coverage === "excluded")!;
    const other = pkg.documents.find((d) => d.kind === "quote" && quoteFacts(d)?.boqLineId !== line.id)!;
    const withRef = { ...pkg, documents: pkg.documents.map((d) => (d.id === other.id ? { ...d, facts: { ...(d.facts ?? {}), boqLineId: line.id }, factsSource: { method: "agent" as const, byId: "EYAL" } } : d)) };
    expect(findQuoteFor(withRef, line)?.id).toBe(other.id);
    const seed = initialState();
    const po = seed.erp.purchaseOrders.find((p) => p.attachmentId && p.status === "פתוחה")!;
    const fixed = { ...pkg, documents: pkg.documents.map((d) => (d.id === po.attachmentId ? { ...d, facts: { qty: po.qty, unit: po.unit, unitPrice: po.unitPrice, amount: po.amount } } : d)) };
    expect(checkUnits(fixed, seed.erp, po.id)).toHaveLength(0);
  });

  it("the registry exposes the review and extraction tools", () => {
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["get_review_material", "raise_finding", "record_review_pass", "set_document_facts"]));
  });
});
