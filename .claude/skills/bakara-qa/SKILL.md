---
name: bakara-qa
description: Answer questions about a project's budget, forecast, findings, contracts, invoices, orders, documents and history with sourced figures — bakara read tools first, read-only SQL second. Use for any question about the data ("מה השתנה", "למה הסעיף עלה", "מה עדיין אומדן", "כמה שילמנו לספק").
---

# Answering questions with sources

Every figure is quoted from a tool result and named for what it is: נרשם (חשבונות מאושרים), התחייבות (חוזה חתום / הזמנה מאושרת), אומדן (הצעת מחיר / אומדן פנימי / נספח מחיר). Never derive a total yourself — take it from a tool (`totalAmount`, `totals`, `recorded`) or ask the database for the sum.

## 1. Pick the tool
| Question | Tool |
| --- | --- |
| What changed since the previous control; why the total moved | `get_control` (adjustments = 4א, corrections = 4ב) and `get_forecast` (`change` per section, `previousEac`) |
| Is the overrun price or quantity | `get_forecast` with `sectionId` (lines: qty × unitPrice, basis) and `get_contract` (`appendixInForce`) |
| What is still an estimate and not an order | `get_forecast.uncoveredByBasis` (lines by basis; allocations shown separately) |
| Why a section rose | `get_section` (forecast lines, adjustments, corrections that moved recorded amounts, invoices) |
| A supplier's history / where their invoices went | `get_supplier` (`invoicesBySection`) |
| Which issues closed / are stale | `list_issues` (status, openedInControl, closedAt) |
| Who changed what and when | `query_change_log` (`since`, `recordId`, `byId`) |
| Is a record right | `run_check` for that record |
| A document's content (quote validity, appendix price, exclusion clause) | `search_documents` → `get_document` |
| The stored report / a saved version | `build_report` (`summary`), `list_report_versions` |

If the control has not been run yet (`get_project.control.status = idle`), say the figures reflect the previous final control plus the live ERP data, and offer `/bakara-control`.

## 2. Then read-only SQL
For anything the tools do not return, Supabase `execute_sql` with SELECT only, always `where project_id = '<id>'`. Shapes:
```sql
-- recorded per section up to a cutoff (approved/paid invoices received before it)
select section_id, sum(amount) from invoices where project_id = 'HADARIM' and status <> 'בבדיקה' and date_received < '2026-09-01' group by 1 order by 1;
-- a supplier's invoices
select id, date, section_id, amount, description_he from invoices where project_id = 'HADARIM' and supplier_id = 'SUP-NTB' order by date;
-- the draft forecast lines with their basis
select section_id, description_he, qty, unit, unit_price, amount, basis, kind from forecast_lines where project_id = 'HADARIM' and control_date = '2026-09-01' order by section_id, position;
-- saved control sessions
select control_date, status, finalized, operator_id, updated_at from controls where project_id = 'HADARIM';
```
Tables: `projects, people, suppliers, sections, contracts, documents, invoices, purchase_orders, boq_lines, forecast_versions, forecast_sections, forecast_lines, open_issues, change_log, controls, decisions, forecast_adjustments, data_corrections, audit, report_versions`. Name the table as the source.

## 3. Answer shape
Number first (thousands separators, ₪, before VAT), then its kind, then the source (tool / table / document), then — if the question is really a decision ("should we fund it from contingency?") — the facts and options; the decision is the user's.
