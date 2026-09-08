---
name: bakara-report
description: Build, enrich, adapt and deliver the budget-control report per the report standard — executive summary, sections table, forecast changes vs data corrections, material sections, risks, issues, trends, CEO page, Word export — and finalize the control. Use when the control is done or the user asks for the report, its structure, or to add risks/events/assumptions.
---

# The living report

The report is produced by `build_report` from the current state per `budgetcontrolreportstandard.md`. You deliver it, explain it and shape it; you never restate a number that is not in it, and never recompute.

## Build and deliver
1. `build_report` (default `format: "summary"`). Give the user:
   - the header line (`summary.header.controlLabelHe`, cutoff, previous control);
   - `summary.executive.paragraphHe` verbatim and the key table (`keyTable`: תקציב, תחזית לגמר, סטייה, שינוי מבקרה קודמת, נרשם, ביצוע פיזי, בלתי צפוי, יתרה לא מכוסה);
   - 4א and 4ב in two sentences — `forecastChanges` (typed changes with basis, total `forecastChangesTotal`) and `corrections` (data fixes with no effect on the total). Keep them apart;
   - `executive.decisionsHe` — the decision management must take;
   - `materialSections` (why each is analysed: threshold, share of budget, weak basis) and `risks`, `openIssues` on request.
2. The full text: `build_report` with `format: "markdown"` (read `markdown`; write it with `path` if the user wants a file).
3. To hand over: `build_report` with `format: "docx"`, a `label` (e.g. "בקרה 09/2026") and `saveVersion: true` — the Word file path is in `path`, the stored version id in `versionId`. `list_report_versions` lists what was saved.

If the user disputes a figure, point to the report section and its source; the underlying data is in `get_forecast` / `get_section`. Do not compute.

## Enrich before delivering
What the data cannot know, the controller records — each note lands in the right section of the report:
- `add_control_note` kind `risk` (§7: `textHe`, `sectionId`, `exposureHe`, `likelihoodHe`, `triggerHe`, `ownerId`), `event` (§2 material events of the period), `decision` (§1 decisions needed), `assumption` (§11), `note` (an executive-summary bullet).
- `set_project_status` — measured physical progress and schedule from the site report (never derived from spend).
- `open_task` / `set_task_status` — the responsibility table (§8): owner, due date, impact if ignored; close what was done.
Risks the data itself implies (quote expiry, appendix-priced remainders, stale issues) are already derived; do not duplicate them.

## Adapt the structure
`set_report_config`: `includeTrends` (§10 comparison to the previous control and trends), `splitByBuilding` (sections table also per building — the note names invoices that could not be split at source; tag them with `set_invoice_building` if the user wants), `ceoVersion` (one-page CEO version: `build_report` with `tab: "ceo"`), `execSummaryMaxLines`. Rebuild after each change and describe what was added.

`save: true` keeps the structure for the project's next controls. Say what is kept (structure: sections, comparison, building split, CEO version, summary length, the separation of corrections from forecast changes) and what is never kept (the data and conclusions — recomputed every control).

## Finalize and send
`finalize_control` only when the user says the control is closed; the header then reads "גרסה סופית". There is no mailbox: "שלח לדנה" = hand over the Word path (and the CEO version if configured) and say so plainly.
