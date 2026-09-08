import { buildBaselineState, PRIOR_REPORT_CUTOFF } from "../data/seed";
import { analyzeAll } from "../domain/commands/core";
import { seedPriorReport } from "../domain/commands/reports";
import type { DemoState } from "../domain/types";

export interface CreateOptions {
  /** Applied to the raw baseline before the prior report is frozen and before the initial analysis. */
  overlayBefore?: (state: DemoState) => DemoState;
  /** Applied after the prior report and the initial analysis (for "already posted but not yet re-checked" fixtures). */
  overlayAfter?: (state: DemoState) => DemoState;
}

let sessionCounter = 0;

export function newSessionId(prefix = "session"): string {
  sessionCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${sessionCounter}`;
}

/**
 * Canonical demo initialization: baseline ledger -> frozen prior report (from the prior-world ledger)
 * -> automatic analysis of everything already received (baseline findings) -> clean revision 1.
 */
export function createDemoState(sessionId: string, options: CreateOptions = {}): DemoState {
  let s = buildBaselineState(sessionId);
  if (options.overlayBefore) s = options.overlayBefore(s);
  s = seedPriorReport(s, "HAD", PRIOR_REPORT_CUTOFF, "RPT-HAD-2026-08-31", "2026-08-31T09:10:00+03:00");
  s = analyzeAll(s);
  if (options.overlayAfter) s = options.overlayAfter(s);
  return { ...s, revision: 1, activity: s.activity.slice(-20) };
}
