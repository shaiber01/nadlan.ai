import { describe, expect, it } from "vitest";
import { FINDING_KINDS, checkAllocation, checkContractOverrun, checkCoverage, checkCumulative, checkDates, checkDocuments, checkDuplicates, checkOrderAllocation, checkPrices, checkRetention, checkReviewAging, checkUnits, compositeId, quoteFacts, runChecks, type HFinding, type OrderFixPatch } from "../src/hadarim/engine/checks";
import { createInvoice, decide, initialState, pkg, reviewFindings, revealAllSteps, startControl, updateInvoiceSection, updatePurchaseOrderSection } from "../src/hadarim/engine/commands";
import { installScenario } from "./fixtures/scenario";
import { changeLogId, heartbeatWork } from "../src/hadarim/engine/heartbeat";
import type { V2State } from "../src/hadarim/engine/model";
import { raiseFinding } from "../src/hadarim/engine/operations";
import { buildReport } from "../src/hadarim/engine/report";

// the seed is clean: the cards below need the demo's errors, with the revised BOQ page already read, as the agent would before a control runs
installScenario({ processedBoqRevision: true });

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

describe("one card per record", () => {
  const draftOf = (s: V2State) => pkg.forecasts.find((f) => f.controlDate === s.control.controlDate)!;
  const onRecord = (findings: HFinding[], type: string, id: string) => findings.filter((f) => f.record.type === type && f.record.id === id);
  const lastLogId = (s: V2State) => Math.max(0, ...s.erp.changeLog.map(changeLogId));

  /** An order on the wrong section whose line disagrees with its quote: two findings with fixes that agree. */
  function brokenOrder() {
    const seed = initialState();
    const po = seed.erp.purchaseOrders.find((p) => {
      if (!p.contractId || pkg.contracts.find((c) => c.id === p.contractId)!.sectionId !== p.sectionId || p.status !== "פתוחה") return false;
      const facts = quoteFacts(pkg.documents.find((d) => d.id === p.attachmentId));
      return !!facts && facts.qty != null && facts.unitPrice != null && !!facts.unit && facts.amount === p.amount;
    })!;
    expect(po).toBeTruthy();
    const facts = quoteFacts(pkg.documents.find((d) => d.id === po.attachmentId))!;
    const right = po.sectionId;
    const wrong = other(po.sectionId);
    let s = updatePurchaseOrderSection(seed, po.id, wrong as never, "EYAL");
    // the classic kg-keyed price when the seed's line still agrees with the quote
    if (Math.abs(po.unitPrice - facts.unitPrice!) < 0.005) s = { ...s, erp: { ...s.erp, purchaseOrders: s.erp.purchaseOrders.map((p) => (p.id === po.id ? { ...p, unitPrice: facts.unitPrice! / 1000 } : p)) } };
    return { s, po, facts, right, wrong };
  }

  it("an order whose section and line both disagree with its sources is one card: members, the union of the fixes, one question", () => {
    const { s, po, facts, right } = brokenOrder();
    const { findings } = runChecks(pkg, s.erp, draftOf(s), s.control.controlDate);
    const [card, ...rest] = onRecord(findings, "po", String(po.id));
    expect(rest).toEqual([]);
    expect(card).toMatchObject({ id: compositeId({ type: "po", id: String(po.id) }), kind: "record", origin: "check", record: { type: "po", id: String(po.id) } });
    expect(card.members!.map((m) => m.id)).toEqual([`F-ALLOC-PO-${po.id}`, `F-UNIT-${po.id}`]);
    expect(card.proposedFix!.patch as OrderFixPatch).toEqual({ sectionId: right, qty: facts.qty, unit: facts.unit, priceUnit: facts.unit, unitPrice: facts.unitPrice });
    // one line of problem per member; the union of the sources without duplicates; the people of the record
    expect(card.problemHe.split("\n")).toHaveLength(2);
    expect(card.problemHe).toContain(card.members![0].problemHe);
    expect(card.problemHe).toContain(card.members![1].problemHe);
    const keys = card.sources.map((x) => `${x.kind}:${x.refId}:${x.labelHe}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of card.members!) for (const x of m.sources) expect(keys).toContain(`${x.kind}:${x.refId}:${x.labelHe}`);
    expect(card.people?.some((x) => x.id === "EYAL")).toBe(true);
    expect(card.decision.options.map((o) => o.id)).toEqual(["apply", "refer", "accept"]);
    for (const o of card.decision.options) expect(o.consequenceHe).toMatch(/\S/);
    expect(card.detailsTable![0]).toEqual(["שדה", "נרשם", "התיקון המוצע"]);
    expect(card.detailsTable!.slice(1).map((r) => r[0])).toEqual(["סעיף תקציבי", "כמות", "יחידה", "יחידת מחיר", "מחיר יח׳"]);
    // the member checks stay individually runnable, with their own ids
    expect(checkOrderAllocation(pkg, s.erp, po.id).map((f) => f.id)).toEqual([`F-ALLOC-PO-${po.id}`]);
    expect(checkUnits(pkg, s.erp, po.id).map((f) => f.id)).toEqual([`F-UNIT-${po.id}`]);
    // ungrouped findings keep their ids: the seed's other findings are untouched
    expect(findings.filter((f) => f.kind !== "record").every((f) => !f.members)).toBe(true);
  });

  it("applying the card writes both fields, records a correction per field for its member, decides every member, and the checks then raise nothing on the record", () => {
    const { s, po, facts, right } = brokenOrder();
    const running = reviewFindings(revealAllSteps(startControl(s, "בקרה")));
    const card = running.control.findings.find((f) => f.kind === "record" && f.record.id === String(po.id))!;
    // the report lists the record once, undecided
    const before = buildReport(pkg, running).openFindings.filter((r) => r.id === card.id || card.members!.some((m) => m.id === r.id));
    expect(before.map((r) => r.kind)).toEqual(["record"]);
    expect(before[0].fixHe).toBe(card.proposedFix!.labelHe);
    const applied = decide(running, card.id, "apply");
    const after = applied.erp.purchaseOrders.find((p) => p.id === po.id)!;
    expect(after).toMatchObject({ sectionId: right, qty: facts.qty, unit: facts.unit, priceUnit: facts.unit, unitPrice: facts.unitPrice, amount: po.amount });
    const corrections = applied.control.corrections.filter((c) => c.recordId === String(po.id));
    expect(corrections.map((c) => [c.fieldHe, c.findingId, c.status])).toEqual([
      ["סעיף תקציבי", `F-ALLOC-PO-${po.id}`, "applied"],
      ["כמות / יחידה / מחיר יח׳", `F-UNIT-${po.id}`, "applied"],
    ]);
    expect(corrections[0].beforeHe).not.toBe(corrections[0].afterHe);
    expect(corrections[0].crossSectionHe).toContain(right);
    for (const id of [card.id, ...card.members!.map((m) => m.id)]) {
      expect(applied.control.decisions[id], id).toMatchObject({ status: "handled", routeId: "update" });
      expect(applied.control.decisions[id].verifiedHe).toContain(`הזמנה ${po.id}`);
      expect(applied.audit.some((a) => a.textHe.includes(id)), id).toBe(true);
    }
    expect(applied.erp.changeLog.slice(running.erp.changeLog.length).map((c) => [c.recordId, c.field, c.byId])).toEqual([[String(po.id), "סעיף תקציבי", applied.operatorId], [String(po.id), "כמות / יחידה / מחיר יח׳", applied.operatorId]]);
    // the record is clean now — for the control's checks and for the report
    expect(onRecord(runChecks(pkg, applied.erp, draftOf(applied), applied.control.controlDate).findings, "po", String(po.id))).toEqual([]);
    expect(buildReport(pkg, applied).openFindings.some((r) => r.id === card.id || card.members!.some((m) => m.id === r.id))).toBe(false);
  });

  it("refer hands the whole record to whoever keys orders; accept closes every member; the record is untouched either way", () => {
    const { s, po, wrong } = brokenOrder();
    const running = reviewFindings(revealAllSteps(startControl(s, "בקרה")));
    const card = running.control.findings.find((f) => f.kind === "record" && f.record.id === String(po.id))!;
    const keyer = pkg.people.find((x) => x.roleHe.includes("ביצוע")) ?? pkg.people.find((x) => x.roleHe.includes("חשבונות"))!;
    const referred = decide(running, card.id, "refer");
    expect(referred.erp.purchaseOrders.find((p) => p.id === po.id)!.sectionId).toBe(wrong);
    expect(referred.control.tasks.filter((t) => t.findingId === card.id)).toHaveLength(1);
    expect(referred.control.tasks.at(-1)).toMatchObject({ ownerId: keyer.id, status: "pending_execution" });
    for (const id of [card.id, ...card.members!.map((m) => m.id)]) expect(referred.control.decisions[id]).toMatchObject({ status: "pending_execution", ownerId: keyer.id });
    const accepted = decide(running, card.id, "accept", "נבדק מול הרכש");
    expect(accepted.erp.purchaseOrders.find((p) => p.id === po.id)).toEqual(running.erp.purchaseOrders.find((p) => p.id === po.id));
    for (const id of [card.id, ...card.members!.map((m) => m.id)]) expect(accepted.control.decisions[id]).toMatchObject({ status: "handled" });
    expect(accepted.control.corrections.filter((c) => c.recordId === String(po.id))).toEqual([]);
    expect(buildReport(pkg, accepted).openFindings.some((r) => r.id === card.id)).toBe(false);
  });

  it("two findings on one record whose fixes conflict stay two cards; fixes on different fields fold into one", () => {
    const seed = initialState();
    const inv = seed.erp.invoices.find((i) => i.retentionPct > 0 && !!i.contractId && i.docType === "חשבון חלקי" && !!i.attachmentId && !!pkg.documents.find((d) => d.id === i.attachmentId)?.facts && i.cumulativeNow != null && i.cumulativePrev != null)!;
    expect(inv).toBeTruthy();
    const doc = pkg.documents.find((d) => d.id === inv.attachmentId)!;
    // the retention card asks for the retention of the recorded amount; the document card for the retention of the document's amount
    const brokenRetention = patchInvoice(seed, inv.id, (i) => ({ ...i, retentionAmt: i.retentionAmt + 7 }));
    const p = { ...pkg, documents: pkg.documents.map((d) => (d.id === doc.id ? { ...d, facts: { ...d.facts, amountThis: inv.amount + 5_000, cumulativeNow: (inv.cumulativePrev ?? 0) + inv.amount + 5_000 } } : d)) };
    const conflicting = onRecord(runChecks(p, brokenRetention.erp, draftOf(seed), seed.control.controlDate).findings, "invoice", String(inv.id));
    expect(conflicting.map((f) => f.kind).sort()).toEqual(["document", "retention"]);
    expect(conflicting.every((f) => f.proposedFix && !f.members)).toBe(true);
    // retention and cumulative name different fields (and the document, which states the cumulative, agrees): one card, all fixed on approval, one correction row per field
    const brokenBoth = patchInvoice(brokenRetention, inv.id, (i) => ({ ...i, cumulativeNow: (i.cumulativeNow ?? 0) + 1000 }));
    const [card, ...rest] = onRecord(runChecks(pkg, brokenBoth.erp, draftOf(seed), seed.control.controlDate).findings, "invoice", String(inv.id));
    expect(rest).toEqual([]);
    expect(card.id).toBe(compositeId({ type: "invoice", id: String(inv.id) }));
    expect(card.members!.map((m) => m.kind)).toEqual(expect.arrayContaining(["cumulative", "retention"]));
    expect(card.members!.length).toBeGreaterThanOrEqual(2);
    const running = reviewFindings(revealAllSteps(startControl(brokenBoth, "בקרה")));
    const applied = decide(running, card.id, "apply");
    const fixed = applied.erp.invoices.find((i) => i.id === inv.id)!;
    expect(fixed.retentionAmt).toBe(Math.round((fixed.amount * fixed.retentionPct) / 100));
    expect(fixed.cumulativeNow).toBe((fixed.cumulativePrev ?? 0) + fixed.amount);
    const rows = applied.control.corrections.filter((c) => c.recordId === String(inv.id));
    expect(rows.map((c) => [c.fieldHe, c.findingId])).toEqual([
      ["עכבון", `F-RET-${inv.id}`],
      ["מצטבר", `F-CUM-${inv.id}`],
    ]);
    expect(onRecord(runChecks(pkg, applied.erp, draftOf(applied), applied.control.controlDate).findings, "invoice", String(inv.id))).toEqual([]);
  });

  it("the heartbeat and the report's open findings know a card through its members and a member through its card", () => {
    const { s, po } = brokenOrder();
    const top = lastLogId(s);
    const id = compositeId({ type: "po", id: String(po.id) });
    const memberIds = [`F-ALLOC-PO-${po.id}`, `F-UNIT-${po.id}`];
    // nothing changed above the watermark and no session: the card is new once, and not again once presented — by its own id or by its members'
    expect(heartbeatWork(pkg, s, top).findings.map((f) => f.id)).toContain(id);
    expect(heartbeatWork(pkg, s, top, [id]).findings.map((f) => f.id)).not.toContain(id);
    expect(heartbeatWork(pkg, s, top, memberIds).findings.map((f) => f.id)).not.toContain(id);
    // a session that holds the card: not new; the report lists it once as undecided, and after the decision not at all
    const running = reviewFindings(revealAllSteps(startControl(s, "בקרה")));
    expect(heartbeatWork(pkg, running, lastLogId(running)).findings.map((f) => f.id)).not.toContain(id);
    const rows = buildReport(pkg, running).openFindings.filter((r) => r.id === id || memberIds.includes(r.id));
    expect(rows.map((r) => [r.id, r.statusHe])).toEqual([[id, "טרם הוכרע"]]);
    // a session that holds the members as their own cards (an earlier run) knows the card too
    const asMembers: V2State = { ...running, control: { ...running.control, findings: running.control.findings.flatMap((f) => (f.id === id ? f.members! : [f])) } };
    expect(heartbeatWork(pkg, asMembers, lastLogId(asMembers)).findings.map((f) => f.id)).not.toContain(id);
    expect(buildReport(pkg, asMembers).openFindings.filter((r) => r.id === id)).toEqual([]);
  });
});
