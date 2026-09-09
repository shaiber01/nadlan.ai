---
name: bakara-report
description: Build, enrich, adapt and deliver the budget-control report per the report standard — executive summary, sections table, forecast changes vs data corrections, material sections, risks, issues, trends, CEO page, Word export — and finalize the control. Use when the control is done or the user asks for the report, its structure, or to add risks/events/assumptions.
---

# The living report

The report is produced by `build_report` from the current state per `budgetcontrolreportstandard.md`; every call rebuilds it from the live database, so call it again whenever something changed. You deliver it, explain it and shape it; you never restate a number that is not in it, and you do not redo its arithmetic by hand.

## Before delivering: the checks
`build_report` runs all the checks on the current data by itself. Its result carries `attentionHe` and `summary.openFindings` when something needs a decision: findings of the session nobody decided on, and findings the checks raise beyond the session ("הבקרה טרם רצה" / "חדש מאז הרצת הבקרה"). Walk them before delivering: for each, the recommended fix (`fixHe`) and the people involved (`peopleHe`); get the decision through `/bakara-control` (`run_control` first if the control has not run, so decisions can be recorded), then build again. A report delivered with open findings is delivered as not final, and you say so.

`attentionHe` also says when the review pass was not done for this control (`/bakara-control` step 5): do it before delivering — the report's sources line states whether the agent's review was done.

## Build and deliver
1. `build_report` (default `format: "summary"`). Give the user:
   - the header line (`summary.header.controlLabelHe`, cutoff, previous control);
   - `summary.executive.paragraphHe` verbatim and the key table (`keyTable`: תקציב, תחזית לגמר, סטייה, שינוי מבקרה קודמת, נרשם, ביצוע פיזי, בלתי צפוי, יתרה לא מכוסה);
   - 4א and 4ב in two sentences — `forecastChanges` (typed changes with basis, total `forecastChangesTotal`) and `corrections` (data fixes with no effect on the total). Keep them apart;
   - `executive.decisionsHe` — the decision management must take;
   - `materialSections` (why each is analysed: threshold, share of budget, weak basis) and `risks`, `openIssues` on request.
2. The full text: `build_report` with `format: "markdown"` (read `markdown`; write it with `path` if the user wants a file).
3. To hand over: `build_report` with `format: "docx"` (Word) or `format: "xlsx"` (Excel, one sheet per table), a `label` (e.g. "בקרה 09/2026") and `saveVersion: true` — the file path is in `path`, the stored version id in `versionId`. `list_report_versions` lists what was saved.

If the user disputes a figure, point to the report section and its source and pull the underlying data with `get_forecast` / `get_section` (which recalculate from the database); do not work the number out by hand.

## Enrich before delivering
What the data cannot know, the controller records — each note lands in the right section of the report:
- `add_control_note` kind `risk` (§7: `textHe`, `sectionId`, `exposureHe`, `likelihoodHe`, `triggerHe`, `ownerId`), `event` (§2 material events of the period), `decision` (§1 decisions needed), `assumption` (§11), `note` (an executive-summary bullet), `change_order` and `claim` (§6 — the ERP holds neither, so §6 says "none recorded" until you record them; ask the user).
- `set_project_status` — measured physical progress and schedule from the site report (never derived from spend); also the project's materiality thresholds (§5) and risk assumptions (§7: quote-expiry exposure %, price step), which `get_project` shows and the report states — change them only on the user's instruction, and say that the material sections or risk exposures were re-derived.
- `open_task` / `set_task_status` — the responsibility table (§8): owner, due date, impact if ignored; close what was done.
Risks the data itself implies (quote expiry, appendix-priced remainders, stale issues) are already derived; do not duplicate them.

## Adapt the structure
`set_report_config`: `includeTrends` (§10 comparison to the previous control and trends), `splitByBuilding` (sections table also per building — the note names invoices that could not be split at source; tag them with `set_invoice_building` if the user wants), `ceoVersion` (one-page CEO version: `build_report` with `tab: "ceo"`), `execSummaryMaxLines`. Rebuild after each change and describe what was added.

`save: true` keeps the structure for the project's next controls. Say what is kept (structure: sections, comparison, building split, CEO version, summary length, the separation of corrections from forecast changes) and what is never kept (the data and conclusions — recomputed every control).

## Finalize and send
`finalize_control` only when the user says the control is closed; the header then reads "גרסה סופית". There is no mailbox: "שלח לדנה" = hand over the Word path (and the CEO version if configured) and say so plainly.

## Where people read it
The web app's "דוח הבקרה" tab shows this control live (rebuilt from the session on every change) and lists the saved versions; nothing is edited there. If the user has it open, they see your decisions as you record them — say so when relevant.
