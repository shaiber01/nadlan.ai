---
name: bakara-report
description: Build, enrich, adapt and deliver the budget-control report per the report standard — executive summary, cost and quantity indices (₪ per m², steel and concrete per m²), sections table, forecast changes vs data corrections, material sections, risks, issues, trends, CEO page, Word and Excel exports — and finalize the control. Use when the control is done or the user asks for the report, its structure, its KPIs, or to add risks/events/assumptions.
---

# The living report

The report is produced by `build_report` from the current state per `budgetcontrolreportstandard.md`; every call rebuilds it from the live database, so call it again whenever something changed. You deliver it, explain it and shape it; you never restate a number that is not in it, and you do not redo its arithmetic by hand.

## Before delivering: heartbeat → readiness → one build
1. `/bakara-heartbeat` first: it processes the documents nobody read yet and walks the ERP records inserted or changed since the last pass, and its findings are decided there.
2. `report_readiness` — one small call, no rendering. `ready` says whether the report can go out; `attentionHe` names what stands in the way: pending documents, changes since the last heartbeat, findings nobody decided on (the session's open ones, what the checks raise beyond it — "הבקרה טרם רצה" / "חדש מאז הרצת הבקרה" — and findings an earlier heartbeat presented that nobody decided), the review pass not done (`/bakara-control` step 5; the report's sources line states whether it was done). `openFindings` carries each finding's recommended fix (`fixHe`) and the people involved (`peopleHe`): walk them through `/bakara-control` (`run_control` first if the control has not run, so decisions can be recorded). Do not build the report to learn any of this.
3. Build once, when `ready` is true (or the user chooses to deliver with open findings): `build_report` in the format the user needs. A docx or xlsx build returns the same `summary` as a summary build — never pair the two. If the final build still carries `attentionHe`, it is binding: walk what it lists and build again. A report delivered with open findings is delivered as not final, and you say so.

Saving a version (`saveVersion` / `label`) and `finalize_control` are refused, with the reason, while a document is pending, no heartbeat was ever recorded, or the checks raise findings on records changed since the last heartbeat that nobody presented (`report_readiness.canSaveVersion` and `blockersHe` say so in advance). Building without saving always works.

## Build and deliver
1. `build_report` — the format the user needs: `summary` (default) to talk it through; `docx` (Word) or `xlsx` (Excel, one sheet per table) with a `label` (e.g. "בקרה 09/2026") and `saveVersion: true` when handing over — the file path is in `path`, the stored version id in `versionId` (`list_report_versions` lists what was saved), and the result's `summary` is what you deliver from. Give the user:
   - the header line (`summary.header.controlLabelHe`, cutoff, previous control);
   - `summary.executive.paragraphHe` verbatim and the key table (`keyTable`: תקציב, תחזית לגמר, סטייה, שינוי מבקרה קודמת, נרשם, ביצוע פיזי, בלתי צפוי, יתרה לא מכוסה);
   - 4א and 4ב in two sentences — `forecastChanges` (typed changes with basis, total `forecastChangesTotal`) and `corrections` (data fixes with no effect on the total). Keep them apart;
   - `summary.kpis` (§2א) when the user asks how the project compares or what it costs per m²: `total.eacPerSqm` against `total.budgetPerSqm` and the project's reference range (`rangeStatus`), the cost groups (`groups`: שלד / מעטפת וגמר / מערכות / פיתוח / תקורה, ₪ per m² with the basis composition), and the material indices (`materials`: ברזל ק״ג/מ״ר, בטון מ״ק/מ״ר, טפסות, עפר, בנייה, איטום, טיח, ריצוף — `perSqm` with `perSqmUnitHe`, `rangeStatus` against the project's KPI policy, `deliveredQty` only when invoices carry a quantity — otherwise `deliveredNoteHe` says what it rests on — and the three unit prices: `budgetUnitPrice`, `paidUnitPrice`, `currentUnitPrice` with `currentPriceBasisHe`). An index outside its range is a question to check, not a finding; say so. `derived` holds יחס ברזל לבטון (ק״ג/מ״ק);
   - `executive.decisionsHe` — the decision management must take;
   - `materialSections` (why each is analysed: threshold, share of budget, weak basis) and `risks`, `openIssues` on request.
2. The full text, only if the user wants it: `build_report` with `format: "markdown"` (read `markdown`; write it with `path` if the user wants a file).

If the user disputes a figure, point to the report section and its source and pull the underlying data with `get_forecast` / `get_section` (which recalculate from the database); do not work the number out by hand.

## Enrich before delivering
What the data cannot know, the controller records — each note lands in the right section of the report:
- `add_control_note` kind `risk` (§7: `textHe`, `sectionId`, `exposureHe`, `likelihoodHe`, `triggerHe`, `ownerId`), `event` (§2 material events of the period), `decision` (§1 decisions needed), `assumption` (§11), `note` (an executive-summary bullet), `change_order` and `claim` (§6 — the ERP holds neither, so §6 says "none recorded" until you record them; ask the user).
- `set_project_status` — measured physical progress and schedule from the site report (never derived from spend); also the project's materiality thresholds (§5), risk assumptions (§7: quote-expiry exposure %, price step) and the KPI reference ranges (§2א, `kpiRanges` keyed by index id: `cost_per_sqm`, `steel`, `concrete`, `steel_per_concrete`, or another material index; `null` removes one), which `get_project` shows and the report states — change them only on the user's instruction, and say that the material sections, risk exposures or range verdicts were re-derived.
- `open_task` / `set_task_status` — the responsibility table (§8): owner, due date, impact if ignored; close what was done.
Risks the data itself implies (quote expiry, appendix-priced remainders, stale issues) are already derived; do not duplicate them.

## Adapt the structure
`set_report_config`: `includeTrends` (§10 comparison to the previous control and trends), `splitByBuilding` (sections table also per building — the note names invoices that could not be split at source; tag them with `set_invoice_building` if the user wants), `byChapter` (sections table also by the chapters of the Interministerial Specification, הספר הכחול — each section under its primary chapter, with the BOQ lines per chapter), `ceoVersion` (one-page CEO version: `build_report` with `tab: "ceo"`), `execSummaryMaxLines`. Rebuild after each change and describe what was added.

The sections table's "תקציב מאושר / שינויים / תקציב מעודכן" columns come from the original budget and the approved budget changes (`list_budget_changes`); when changes exist the key table also shows the original budget and the net change. Budget changes are recorded through `/bakara-erp` on instruction, never to absorb a variance.

`save: true` keeps the structure for the project's next controls; ask first with `AskUserQuestion` (header "תצורה", "לשמור את התצורה לבקרות הבאות?", כן / לא). Say what is kept (structure: sections, comparison, building split, CEO version, summary length, the separation of corrections from forecast changes) and what is never kept (the data and conclusions — recomputed every control).

## Finalize and send
`finalize_control` only when the user says the control is closed — confirm with `AskUserQuestion` (header "סגירה", "לסגור את הבקרה כגרסה סופית?"); the header then reads "גרסה סופית". There is no mailbox: "שלח לדנה" = hand over the Word path (and the CEO version if configured) and say so plainly.

## Where people read it
The report page (`report.html`, hosted at `https://shaiber01.github.io/nadlan.ai/report.html`) shows this control live (rebuilt from the session on every change) and lists the saved versions next to it, with PDF, Word and Excel exports; nothing is edited there, and its source links open the ERP record in a new tab. If the user has it open, they see your decisions as you record them — say so when relevant.
