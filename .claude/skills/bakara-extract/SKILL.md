---
name: bakara-extract
description: Read a document of the project folder — a real file someone uploaded or handed you, or a seed page — describe it and record the structured facts it states, so the deterministic checks run on what the document says. Use when a document is unprocessed, when its facts look wrong against its text, when a check needs a value the record lacks, or when the user gives you a file to add.
---

# Facts from documents

The checks compare structured fields; a document's facts are those fields for the folder (a quote's quantity, unit, unit price, amount, validity and the BOQ line it prices; an appendix's price and start date). The seed's were typed in; real files are read by you — the ERP users only upload, and a document with no `factsSource` is unprocessed until you record its facts.

0. A file the user hands you (a path): `add_document` (kind, title, date, supplier and the record it belongs to when known) — it uploads, opens the folder row and gives you `localPath`.
1. `search_documents` (`unprocessed: true`; or filter by `kind`, `supplierId`, `boqLineId`, `recordType`/`recordId`) — the documents to process, or whose `factsSource.method` is `seed` when you doubt them.
2. `get_document` — a real file: `Read` its `localPath` yourself (PDF or image); its `text` is pdf.js's extraction and Hebrew often comes out scrambled. A seed page: read `text` (headings, paragraphs, table rows) and `anchors`.
2a. `classify_document` — what you determined: kind, a proper Hebrew title, date, supplier, the invoice/order/contract it belongs to (find it: `query_invoices` by the supplier's document number, `query_purchase_orders`, `list_contracts`), a one-line `summaryHe`.
3. `set_document_facts` with what the text states, keys the checks use (this marks the document processed; `{}` with a `noteHe` when it holds nothing the checks use):
   - quote / order confirmation: `qty`, `unit`, `unitPrice`, `amount`, `validUntil` (yyyy-mm-dd), `boqLineId` (when the quote names the BOQ line or the work unmistakably matches one), `supplierId`; a steel quote in kilograms: `qtyKg` and `qtyTon`, `pricePerTon`;
   - price appendix: `pricePerTon` (price per the appendix's unit), `validFrom`;
   - invoice: `amount`, `qty`, `unit`, `unitPrice` when stated;
   - `noteHe`: where in the document you read it.
   Record only what the document says; leave out what it does not. Do not compute a value the document does not state (the checks do the arithmetic).
4. Re-run the check that needed it (`run_check` with the kind and the record) and, if it now raises or clears a finding, walk it as a card. Say that the facts came from your reading (`factsSource.method = agent`).

## Replaced documents
A record's document can be replaced by a newer upload (from the record's card in the ERP, or `add_document` with `replacesDocumentId`). The replaced document keeps its row, marked (`supersededBy`); `search_documents` hides it unless `includeReplaced`, it is never pending, and the checks and the record's card use the current document only. When a heartbeat brings a pending document that replaced another, read the new one and record its facts as usual — do not re-read the replaced one.
