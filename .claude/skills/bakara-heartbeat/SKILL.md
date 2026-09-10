---
name: bakara-heartbeat
description: The heartbeat — one pass over everything new since the previous one: process the documents nobody read yet, check the records inserted or changed in the ERP for errors, present what needs a decision, and record the pass. Use before preparing a report, when the user asks what is new, or on a schedule (cron) with no user present.
---

# The heartbeat

Everything new since the last heartbeat, handled in one pass so the report is short work. `get_heartbeat_work` gathers it deterministically: the pending documents (`facts_source` empty — nobody processed them), the records the ERP users inserted or changed since the watermark (the change log, grouped per record, with who changed what and the contract the record is billed to), the checks' findings on those records or that nothing reported yet, and the control's undecided findings for context. You do the reading; the tools do the arithmetic.

## The pass
1. `get_heartbeat_work` (default: since the last heartbeat; `sinceChangeLogId: 0` for everything, `sinceDate` for a date). Say its `summaryHe` first. If `nothingNew`, record the heartbeat and stop.
2. **Documents** — for each of `documents.pending`, in order:
   - Read it. A real file has `localPath`: `Read` it yourself for a PDF or an image (the extracted `text` is a convenience and Hebrew PDFs often come out scrambled); the seed's pages come as `text`.
   - `classify_document`: kind, a proper Hebrew title, date, supplier (`list_suppliers` / `get_project`), the invoice, order or contract it belongs to when the document names it (`query_invoices` by supplier document number, `query_purchase_orders`, `list_contracts`), a one-line `summaryHe`.
   - `set_document_facts` with what it states (the keys `/bakara-extract` lists); `{}` with a `noteHe` when it carries nothing the checks use. This marks it processed.
   - If it belongs to a record, `run_check` on that record (kind `all`): a quote's price against the order, an invoice's amounts against its record. What the document says that the record does not: a finding.
3. **Changed records** — for each of `changes.records` (a record of type `document` is a deletion in the folder: say who removed which file and where it belonged; there is nothing to check on it). For the others: read `record`, `changes` (what was changed, by whom, with what note) and `contract` (scope, inclusions, exclusions). A description outside the contract's scope, an exclusion billed, a change that a note does not explain, a new invoice without a contract for work that has one: a finding.
4. **Findings** — `findings` are the checks' findings that touch these records. Several findings on one invoice or order whose fixes agree come as one card (kind `record`, `members` lists them, one union fix): one card, one question, and its id is what you present and record. Present each as a card: הבעיה · המקורות · המשמעות · the recommended fix (`proposedFix`) and the people involved (`people`). With a user present, get the decision through `/bakara-control` — each card's decision asked with `AskUserQuestion` (`run_control` first if the control has not run, so decisions can be recorded; findings from your reading go in with `raise_finding`). With no user (scheduled run, `claude -p`) ask nothing: present them in the summary and leave them open — never apply a fix nobody approved.
5. `record_heartbeat`: `untilChangeLogId` from step 1 (so what happened during the pass is covered next time), `documentsProcessed`, `documentIds`, `recordsChanged`, `findingIds` of everything you presented (the next heartbeat repeats a finding only if its record changes again; a `record` card's id covers its members), and a `summaryHe` in three parts: what was processed, what was found, what awaits the user.

## Where it is used
- `/bakara-report` runs this pass before building the report; `report_readiness` (and `build_report.attentionHe`) says when documents are pending or changes happened after the last heartbeat.
- `list_heartbeats` shows the history and how many changes happened since the last one.
- Scheduled: `scripts/heartbeat.sh` runs this skill headless (`claude -p`), for cron or launchd. Nothing is decided in a scheduled run — the summary is what the user reads next.
