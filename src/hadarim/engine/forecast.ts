import type { HForecastLine, HForecastVersion, HInvoice, HSection, HSectionForecast, HadarimPackage, SectionId } from "../data/types";
import { isContingency } from "./checks";
import type { ErpState, ForecastAdjustment } from "./model";

/** Recorded cost per section: approved/paid invoices received before the cutoff date, from the live ERP rows. */
export function recordedBySection(sections: HSection[], invoices: HInvoice[], throughDate: string): Record<SectionId, number> {
  const out = Object.fromEntries(sections.map((s) => [s.id, 0])) as Record<SectionId, number>;
  for (const inv of invoices) {
    if (inv.status === "בבדיקה") continue;
    if (inv.dateReceived >= throughDate) continue;
    out[inv.sectionId] = (out[inv.sectionId] ?? 0) + inv.amount;
  }
  return out;
}

/**
 * The working forecast of the current control = the rolled draft, with recorded amounts re-read from the
 * live ERP (so a corrected allocation moves between sections) and the reviewed adjustments applied.
 */
export interface WorkingSection extends HSectionForecast {
  previousEac: number;
  change: number;
  variance: number;
  basisPct: number;
  lines: HForecastLine[];
}

export interface WorkingForecast {
  controlDate: string;
  previousControlDate: string;
  sections: WorkingSection[];
  totalBudget: number;
  totalRecorded: number;
  totalCommitted: number;
  totalRemainingCommitment: number;
  totalUncovered: number;
  totalEac: number;
  previousTotalEac: number;
  invoicesInReview: { count: number; amount: number };
}

const num = (v: number) => v.toLocaleString("he-IL");

export function workingForecast(pkg: HadarimPackage, erp: ErpState, adjustments: ForecastAdjustment[], controlDate: string): WorkingForecast {
  const draft = pkg.forecasts.find((f) => f.controlDate === controlDate && f.sections)!;
  const previous = pkg.forecasts.filter((f) => f.status === "final" && f.sections && f.controlDate < controlDate).sort((a, b) => (a.controlDate < b.controlDate ? 1 : -1))[0] as HForecastVersion;
  const recorded = recordedBySection(pkg.sections, erp.invoices, controlDate);
  const sections: WorkingSection[] = draft.sections!.map((s) => {
    const rec = recorded[s.sectionId];
    let lines = s.lines.map((l) => ({ ...l }));
    let remainingCommitment = s.remainingCommitment;
    let committed = s.committed;
    // contract-based remaining commitment follows the live recorded amount (contract total is fixed)
    if (s.committed > 0 && lines.some((l) => l.basis === "contract")) {
      remainingCommitment = Math.max(0, s.committed - rec);
      lines = lines.map((l) => (l.basis === "contract" ? { ...l, amount: remainingCommitment } : l));
    }
    for (const adj of adjustments.filter((a) => a.sectionId === s.sectionId)) {
      if (adj.replacesLineId) {
        const portion = adj.committedPortion;
        lines = lines.map((l) => {
          if (l.id !== adj.replacesLineId) return l;
          const price = adj.unitPrice ?? l.unitPrice;
          const qty = adj.qty ?? l.qty;
          if (portion && qty != null && price != null) {
            // the part already on an approved order becomes a commitment line; the rest stays uncovered at the new price
            const restQty = qty - portion.qty;
            return { ...l, qty: restQty, unitPrice: price, amount: restQty * price, basis: adj.basis, sourceRef: adj.sourceRef, descriptionHe: `${l.descriptionHe.split(" — ")[0]} ללא הזמנה — ${num(restQty)} ${adj.unit ?? l.unit ?? ""} × ${num(price)} ₪ (${adj.sourceRef.split(" — ")[0]})` };
          }
          return { ...l, amount: l.amount + adj.amount, unitPrice: price, basis: adj.basis, sourceRef: adj.sourceRef, descriptionHe: adj.descriptionHe };
        });
        if (portion) {
          const price = adj.unitPrice ?? 0;
          const ids = portion.poIds?.length ? portion.poIds : [portion.poId];
          const label = `${ids.length > 1 ? "הזמנות" : "הזמנה"} ${ids.join(", ")}`;
          lines.push({ id: `${adj.id}-po`, sectionId: s.sectionId, descriptionHe: `${label} — ${num(portion.qty)} ${adj.unit ?? ""} × ${num(price)} ₪`, qty: portion.qty, unit: adj.unit ?? null, unitPrice: price, amount: portion.amount, basis: "po", sourceRef: label, kind: "remaining_commitment" });
          remainingCommitment += portion.amount;
          committed += portion.amount;
        }
      } else {
        lines.push({ id: adj.id, sectionId: s.sectionId, descriptionHe: adj.descriptionHe, qty: adj.qty ?? null, unit: adj.unit ?? null, unitPrice: adj.unitPrice ?? null, amount: adj.amount, basis: adj.basis, sourceRef: adj.sourceRef, kind: "uncovered" });
      }
    }
    const uncovered = lines.filter((l) => l.kind === "uncovered").reduce((a, l) => a + l.amount, 0);
    const eac = rec + remainingCommitment + uncovered;
    const prev = previous.sections!.find((p) => p.sectionId === s.sectionId)!;
    const basisPct = eac > 0 ? Math.round(((rec + remainingCommitment) / eac) * 100) : 100;
    return { ...s, recorded: rec, committed, remainingCommitment, uncovered, eac, lines, previousEac: prev.eac, change: eac - prev.eac, variance: eac - s.budget, basisPct };
  });
  const sum = (f: (s: WorkingSection) => number) => sections.reduce((a, s) => a + f(s), 0);
  const inReview = erp.invoices.filter((i) => i.status === "בבדיקה");
  return {
    controlDate,
    previousControlDate: previous.controlDate,
    sections,
    totalBudget: sum((s) => s.budget),
    totalRecorded: sum((s) => s.recorded),
    totalCommitted: sum((s) => s.committed),
    totalRemainingCommitment: sum((s) => s.remainingCommitment),
    totalUncovered: sum((s) => s.uncovered),
    totalEac: sum((s) => s.eac),
    previousTotalEac: previous.totalEac,
    invoicesInReview: { count: inReview.length, amount: inReview.reduce((a, i) => a + i.amount, 0) },
  };
}

export function sectionById(wf: WorkingForecast, id: SectionId): WorkingSection {
  return wf.sections.find((s) => s.sectionId === id)!;
}

export interface UncoveredBreakdown {
  /** Procurement not yet committed: internal estimates, quotes, price-appendix pricing. The report's "אומדנים" figure. */
  lines: HForecastLine[];
  total: number;
  estimate: number;
  quote: number;
  appendix: number;
  /** Internal budget allocations (overhead) — carried in the section forecasts but not procurement. */
  allocations: HForecastLine[];
  allocationTotal: number;
}

/** Uncovered remainder by basis (standard §1 principle 2). The contingency section is reported on its own and excluded here. */
export function uncoveredByBasis(wf: WorkingForecast): UncoveredBreakdown {
  const all = wf.sections.flatMap((s) => s.lines.filter((l) => l.kind === "uncovered" && l.amount > 0 && !isContingency(s.sectionId)));
  const lines = all.filter((l) => l.basis !== "allocation");
  const allocations = all.filter((l) => l.basis === "allocation");
  const by = (b: string) => lines.filter((l) => l.basis === b).reduce((a, l) => a + l.amount, 0);
  return { lines, total: lines.reduce((a, l) => a + l.amount, 0), estimate: by("estimate"), quote: by("quote"), appendix: by("appendix"), allocations, allocationTotal: allocations.reduce((a, l) => a + l.amount, 0) };
}

/** Uncovered procurement at an earlier final control (for the trend), same classification. */
export function uncoveredAt(version: HForecastVersion): number {
  if (!version.sections) return 0;
  return version.sections.filter((s) => !isContingency(s.sectionId)).flatMap((s) => s.lines).filter((l) => l.kind === "uncovered" && l.basis !== "allocation" && l.amount > 0).reduce((a, l) => a + l.amount, 0);
}
