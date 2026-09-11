import { DEMO_FOOTER_HE } from "../../src/hadarim/data/documents";
import { generateHadarimPackage } from "../../src/hadarim/data/generate";
import type { HDocument, HadarimPackage } from "../../src/hadarim/data/types";
import { setPackage } from "../../src/hadarim/engine/package";

/**
 * The demo scenario, injected into the clean seed.
 *
 * The seed itself is deliberately correct (see `tests/hadarim.data.test.ts`), so the tests that need
 * an error for a check to catch inject it from here rather than finding it pre-seeded.
 *
 * What is injected:
 *  - purchase order 2291 keyed in kilograms against a ton unit (12,000 טון × 4.80 ₪, amount still right);
 *  - the steel remainder still priced by the superseded appendix א׳ (4,000 ₪/טון instead of 4,800);
 *  - the revised BOQ page that drops line 57.03.040 from scope, back in the project folder.
 *
 * Invoice 1147 sits on its correct section in the seed; the script moves it to 02 as a live ERP edit,
 * so that error is not injected here.
 */

/** The steel order as bookkeeping keyed it: quantity and price in kilograms, unit field saying tons. */
const UNIT_ERROR_PO_ID = 2291;
/** The BOQ line the revised chapter drops from scope. */
export const REMOVED_BOQ_LINE_ID = "57.03.040";
/** The appendix the stale forecast line is still priced by. */
const STALE_APPENDIX_ID = "A";

/** כתב כמויות גרסה 5 — the revision that drops the drainage line. Not in the seed: it is what this scenario adds. */
function revisedBoqPage(processed: boolean): HDocument {
  const doc: HDocument = {
    id: "boq_v5_ch57",
    kind: "boq_page",
    titleHe: "כתב כמויות גרסה 5 (2.9.2026) — פרק 57: קווי מים, ביוב וניקוז — עדכון",
    date: "2026-09-02",
    supplierId: null,
    fileName: "boq_v5_ch57.pdf",
    blocks: [
      { kind: "heading", text: "כתב כמויות לביצוע — הדרים · גרסה 5 · 2.9.2026 · פרק 57 — קווי מים, ביוב וניקוז — מחליף גרסה 4" },
      {
        kind: "table",
        rows: [
          ["סעיף", "תיאור", "יח׳", "כמות", "מחיר יח׳", "סה״כ"],
          ["57.01.010", "צינור מים פוליאתילן 110 מ״מ, כולל חפירה ומילוי", "מ׳", "140", "380", "53,200"],
          ["57.02.020", "קו ביוב PVC SN8 200 מ״מ בתחום המגרש", "מ׳", "95", "620", "58,900"],
          ["57.02.030", "שוחות בקרה לביוב קוטר 100 ס״מ", "יח׳", "6", "5,500", "33,000"],
          ["57.03.030", "קווי ניקוז פנימיים PVC 250 מ״מ", "מ׳", "60", "560", "33,600"],
          ["57.04.010", "מחבר לתשתית עירונית כולל קידוח ואטימה", "קומפ׳", "1", "110,000", "110,000"],
          ["", "סה״כ פרק 57", "", "", "", "288,700"],
        ],
      },
      { kind: "highlight", text: `עדכון מול גרסה 4: סעיף ${REMOVED_BOQ_LINE_ID} (קו ניקוז חוץ Ø400, קו ראשי עד נקודת החיבור העירונית) הוצא מהיקף שלב זה — יועבר לשלב ב׳ של הפיתוח בהמתנה להחלטת תכנון.` },
      { kind: "paragraph", text: "הוכן: משרד יועצי תשתיות (מטעם האדריכל) · מחליף את גרסה 4 בתיקיית הפרויקט" },
    ],
    footerHe: DEMO_FOOTER_HE,
    anchors: { table: 1, removed: 2 },
  };
  // unprocessed: nobody read it yet, so the coverage gap it implies has not surfaced
  return processed ? { ...doc, facts: { removedLineIds: [REMOVED_BOQ_LINE_ID] }, factsSource: { method: "agent", byId: "EYAL" } } : doc;
}

export interface ScenarioOptions {
  /** true: the revised BOQ page has been read, so the coverage finding can fire. Default: still pending. */
  processedBoqRevision?: boolean;
}

/**
 * The clean seed with the scenario's three errors put back. Does not install it — see `installScenario`.
 * Built from a fresh generator package, so injecting twice cannot compound the errors.
 */
export function scenarioPackage(options: ScenarioOptions = {}, base: HadarimPackage = generateHadarimPackage()): HadarimPackage {
  const staleAppendix = base.contracts.find((c) => c.id === "03-F")!.priceAppendices!.find((a) => a.id === STALE_APPENDIX_ID)!;
  return {
    ...base,
    // the amount is right; the quantity and the unit price are the ones off by a factor of a thousand
    purchaseOrders: base.purchaseOrders.map((p) => (p.id === UNIT_ERROR_PO_ID ? { ...p, qty: p.qty * 1000, unitPrice: p.unitPrice / 1000 } : p)),
    forecasts: base.forecasts.map((version) => {
      if (!version.sections) return version;
      const sections = version.sections.map((section) => {
        const stale = section.lines.map((line) =>
          line.basis === "appendix" && line.qty != null ? { ...line, unitPrice: staleAppendix.pricePerTon, amount: line.qty * staleAppendix.pricePerTon, sourceRef: `נספח א׳ (11/2025) — ${staleAppendix.pricePerTon.toLocaleString("he-IL")} ₪/טון` } : line,
        );
        if (stale.every((line, i) => line === section.lines[i])) return section;
        const uncovered = stale.filter((l) => l.kind === "uncovered").reduce((a, l) => a + l.amount, 0);
        return { ...section, lines: stale, uncovered, eac: section.recorded + section.remainingCommitment + uncovered };
      });
      return { ...version, sections, totalEac: sections.reduce((a, s) => a + s.eac, 0) };
    }),
    documents: [...base.documents, revisedBoqPage(options.processedBoqRevision ?? false)],
  };
}

/** Install the scenario as the engine's package for this test file, and return it. */
export function installScenario(options: ScenarioOptions = {}): HadarimPackage {
  const next = scenarioPackage(options);
  setPackage(next);
  return next;
}
