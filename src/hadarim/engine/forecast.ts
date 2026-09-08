import type { HForecastLine, HForecastVersion, HSectionForecast, HadarimPackage, SectionId } from "../data/types";
import { recordedBySection } from "../data/generate";
import type { ErpState, ForecastAdjustment } from "./model";

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

export function workingForecast(pkg: HadarimPackage, erp: ErpState, adjustments: ForecastAdjustment[], controlDate: string): WorkingForecast {
  const draft = pkg.forecasts.find((f) => f.controlDate === controlDate && f.sections)!;
  const previous = pkg.forecasts.filter((f) => f.status === "final" && f.sections && f.controlDate < controlDate).sort((a, b) => (a.controlDate < b.controlDate ? 1 : -1))[0] as HForecastVersion;
  const recorded = recordedBySection(erp.invoices, controlDate);
  const sections: WorkingSection[] = draft.sections!.map((s) => {
    const rec = recorded[s.sectionId];
    let lines = s.lines.map((l) => ({ ...l }));
    let remainingCommitment = s.remainingCommitment;
    // contract-based remaining commitment follows the live recorded amount (contract total is fixed)
    if (s.committed > 0 && lines.some((l) => l.basis === "contract")) {
      remainingCommitment = Math.max(0, s.committed - rec);
      lines = lines.map((l) => (l.basis === "contract" ? { ...l, amount: remainingCommitment } : l));
    }
    for (const adj of adjustments.filter((a) => a.sectionId === s.sectionId)) {
      if (adj.replacesLineId) {
        lines = lines.map((l) => (l.id === adj.replacesLineId ? { ...l, amount: l.amount + adj.amount, unitPrice: adj.unitPrice ?? l.unitPrice, basis: adj.basis, sourceRef: adj.sourceRef, descriptionHe: adj.descriptionHe } : l));
      } else {
        lines.push({ id: adj.id, sectionId: s.sectionId, descriptionHe: adj.descriptionHe, qty: adj.qty ?? null, unit: adj.unit ?? null, unitPrice: adj.unitPrice ?? null, amount: adj.amount, basis: adj.basis, sourceRef: adj.sourceRef, kind: "uncovered" });
      }
    }
    const uncovered = lines.filter((l) => l.kind === "uncovered").reduce((a, l) => a + l.amount, 0);
    const eac = rec + remainingCommitment + uncovered;
    const prev = previous.sections!.find((p) => p.sectionId === s.sectionId)!;
    const basisPct = eac > 0 ? Math.round(((rec + remainingCommitment) / eac) * 100) : 100;
    return { ...s, recorded: rec, remainingCommitment, uncovered, eac, lines, previousEac: prev.eac, change: eac - prev.eac, variance: eac - s.budget, basisPct };
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

/** Uncovered items by basis: estimate-based money the report must call out (standard §1 principle 2). */
export function uncoveredByBasis(wf: WorkingForecast): { estimate: number; quote: number; appendix: number; lines: (HForecastLine & { sectionNameHe?: string })[] } {
  const lines = wf.sections.flatMap((s) => s.lines.filter((l) => l.kind === "uncovered" && l.amount > 0 && s.sectionId !== "17"));
  const by = (b: string) => lines.filter((l) => l.basis === b).reduce((a, l) => a + l.amount, 0);
  return { estimate: by("estimate"), quote: by("quote"), appendix: by("appendix"), lines };
}
