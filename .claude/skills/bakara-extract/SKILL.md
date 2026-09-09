---
name: bakara-extract
description: Read a document of the project folder (quote, order confirmation, price appendix, invoice, contract excerpt, BOQ page) and record the structured facts it states, so the deterministic checks run on what the document says. Use when a document has no facts, when its facts look wrong against its text, or when a check needs a value the record lacks.
---

# Facts from documents

The checks compare structured fields; a document's facts are those fields for the folder (a quote's quantity, unit, unit price, amount, validity and the BOQ line it prices; an appendix's price and start date). In the seed they were typed in; in the operational system an extraction service would read the PDF. Here you read.

1. `search_documents` (filter by `kind`, `supplierId` or `boqLineId`) — documents with `facts: null`, or whose `factsSource.method` is `seed` when you doubt them.
2. `get_document` — read `text` (headings, paragraphs, table rows) and `anchors`.
3. `set_document_facts` with what the text states, keys the checks use:
   - quote / order confirmation: `qty`, `unit`, `unitPrice`, `amount`, `validUntil` (yyyy-mm-dd), `boqLineId` (when the quote names the BOQ line or the work unmistakably matches one), `supplierId`; a steel quote in kilograms: `qtyKg` and `qtyTon`, `pricePerTon`;
   - price appendix: `pricePerTon` (price per the appendix's unit), `validFrom`;
   - invoice: `amount`, `qty`, `unit`, `unitPrice` when stated;
   - `noteHe`: where in the document you read it.
   Record only what the document says; leave out what it does not. Do not compute a value the document does not state (the checks do the arithmetic).
4. Re-run the check that needed it (`run_check` with the kind and the record) and, if it now raises or clears a finding, walk it as a card. Say that the facts came from your reading (`factsSource.method = agent`).
