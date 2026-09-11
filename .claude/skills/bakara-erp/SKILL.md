---
name: bakara-erp
description: Apply an instructed data change outside a finding card — re-allocate an invoice, correct a purchase order, tag a building, key in an invoice, or change the forecast with a stated basis — through the bakara write tools, attributed and logged. Use when the user tells you to change data or the forecast.
---

# Writes — only on the user's decision

Before writing, restate what will change and who decides (`byId` = their person id from `get_project.people`); when the instruction left either open, ask with `AskUserQuestion` (the change as "כן, בצע" / "לא", or the people as options) rather than guessing. After writing, quote the tool's `changeLog` rows (written by the database triggers) and its `verifiedHe` line (the record re-read from the database).

## ERP records
- `reallocate_invoice` — invoice to another section. Permission-checked (only people who may write allocations; do not work around a refusal). `asCorrection: true` (default) when this is the controller's correction of a wrong allocation — it appears in report §4ב; `asCorrection: false` when the user is doing plain data entry as the ERP's user (e.g. a bookkeeper keying a change) — change log only.
- `correct_purchase_order` — `qty` / `unit` (the quantity's unit) / `priceUnit` (the unit the price is quoted in) / `unitPrice`. The amount is locked: the quantity converted into `priceUnit`, times `unitPrice`, must still equal it (the tool refuses otherwise). So an order quoted per טון but delivered in ק״ג is recorded as `qty` in ק״ג with `priceUnit` טון — 12,000 ק״ג × 4,800 ₪ לטון = 57,600 ₪. `sectionId` moves the order to another budget section — permission-checked like an invoice re-allocation; the invoices booked against the order keep their own section. Same `asCorrection` rule.
- `set_invoice_building` — one of the project's buildings (`get_project.buildings`), the shared bucket (`get_project.buckets.shared`, e.g. משותף) or `null`, for the per-building split.
- `create_invoice` — a new supplier invoice (approved, retention per contract, cumulative computed); returns the assigned number.
- `set_boq_unit_price` — the unit price of one BOQ line (`lineId`, `unitPrice` in whole shekels before VAT, `noteHe` = the basis: an appendix, an agreement with the contractor). This is the covering contract's price schedule — the breakdown of a lump-sum contract — so quote the returned `contract.scheduleTotal` against `contract.amount` and say whether the schedule still ties. It is not a forecast change: if the user means what the work will cost, use `add_forecast_adjustment`.

A correction that came out of a control finding goes through `route_finding` (in `/bakara-control`), not through these, so decision, correction and verification are recorded together.

## The forecast
- `add_forecast_adjustment` — a typed change per the standard (`changeType`: price, quantity, scope, coverage_gap, basis, indexation, schedule, claim, contingency), with `basis` (contract / po / quote / appendix / estimate), `basisHe` in words, `sourceRef` (document or record), `amount` (positive = increase), optional `qty` × `unitPrice`, `documentId`, and `replacesLineId` to re-price an existing draft line instead of adding one. The result shows the section's new forecast.
- `remove_forecast_adjustment` — by id, when the user withdraws a change (confirm first).
An estimate stays an estimate until an order or contract exists; say so.

## Rules
- Never write with SQL. Never delete records.
- Section ids are two digits ("01"–"18"); people and suppliers by their ids (`list_people`, `list_suppliers`).
- A write is visible to the web app immediately and to the next `run_control` ("ברשומה ששונתה היום").

## Budget changes
The budget is not the forecast. On the user's instruction only — "אושרה העברה של 200 אלף מבלתי צפוי לשלד", "המזמין אישר תוספת" — record it with `add_budget_change`: `kind` (transfer between two sections, addition to one, reduction from one), the sections, the amount, the approval date, `reasonHe`, `referenceHe` (the decision, change order or letter) and `approvedById` (who approved; ask if not said). Quote the tool's `verifiedHe` (the change re-read from the database and its change-log row) and `sectionsAfter` (original, changes, updated per section). `list_budget_changes` shows the history and the net per section. A transfer or reduction cannot take a section below zero. The report's sections table shows original, changes and updated budget; the variance is against the updated budget.

