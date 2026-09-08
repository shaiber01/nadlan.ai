---
name: bakara-report
description: Build, adapt and deliver the budget-control report for project הדרים per the report standard — the scene 6–8 flow (full report, comparison and trends, per-building split, CEO one-pager, Word export, saving the configuration, finalizing).
---

# The living report

## Build it
```bash
npm run bakara -- report --md /tmp/hadarim-report.md --docx /tmp/hadarim-report.docx --label "בקרה 09/2026"
```
This builds the report from the current control state (per `budgetcontrolreportstandard.md`), saves a version to `report_versions`, and writes Markdown (for you to read and quote) and Word (to hand over). Read the Markdown file; then give the user:
1. The executive summary paragraph verbatim and the key table (תקציב, תחזית לגמר, סטייה, שינוי מבקרה קודמת).
2. Section 4א (forecast changes) and 4ב (data corrections) in two sentences — these must be kept apart.
3. The decision needed (בלתי צפוי או חריגה), if the summary lists one.
4. Where the files are.

Never restate a number that is not in the Markdown. If the user disputes a figure, point to the report section and its source link; do not recompute.

## Adapt the structure (scene 7)
```bash
npm run bakara -- config --trends on          # section 10: comparison to the previous control and trends
npm run bakara -- config --by-building on     # sections table also per בניין A / B / חניון / משותף
npm run bakara -- config --ceo on             # the one-page CEO version (then: report --ceo --md …)
```
Rebuild with `report` after each change and describe what was added. With the building split, mention what could not be split at source (the tool's note names the invoice, e.g. חשבון 1147 → "משותף"); if the user wants to tag it, use `/bakara-erp` (`erp set-building`).

## Save the configuration (scene 8)
```bash
npm run bakara -- config --save
```
Say what is kept (structure: sections, comparison, building split, CEO version, summary length, the separation of data corrections from forecast changes) and what is never kept (the data and conclusions — recomputed every control).

## Finalize
```bash
npm run bakara -- finalize
```
Only when the user says the control is closed. After that the header reads "גרסה סופית".

## Sending
There is no mailbox in this prototype. "שלח לדנה" = hand over the Word file path (and the CEO version if configured) and say so plainly.
