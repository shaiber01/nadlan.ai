# Hadarim demo — data package spec (preview for approval)

Purpose: define every dataset and document the prototype needs, with numbers that reconcile to the script, before generating files. After approval I generate the package (CSV \+ JSON \+ PDFs \+ SPEC.md \+ the script) as one zip for the Claude Code build.

---

## 1\. Project frame (revised)

| Item | Value |
| :---- | :---- |
| Contractor | אופק ביצוע בע״מ |
| Project | הדרים — 2 buildings (A, B), 8 floors × 3 units \= **48 units**, shared 2-level parking basement |
| Gross area | \~8,700 sqm (≈6,300 above ground incl. common areas, ≈2,400 parking) → 48.0M ≈ 5,500 ₪/sqm |
| Start of execution | 2.11.2025 |
| Status at 1.9.2026 | Building A: floor 7 of 8 cast · Building B: floor 5 · block work started on A lower floors · underground plumbing/electrical sleeves · site development stage A (earthworks, retaining walls, primary infrastructure) largely done |
| Approved budget | 48,000,000 ₪ excl. VAT (version 3, approved 15.3.2026) |
| Controls to date | 1.5, 1.6, 1.7, 1.8.2026 (monthly). Current: 1.9.2026 |
| People | אייל — מנהל פרויקט · רועי — סמנכ״ל ביצוע · דנה — מנכ״לית · שרית — הנהלת חשבונות (appears only in change logs / routing) |

**Change to the script this forces:** scene 2 "215 חשבונות, 31.4 מ׳" → **20.1 מ׳**. Cost incurred at \~42% is what a skeleton-stage project looks like; 65% would be caught instantly. Scene 9 "still estimate" answer also changes (see §7).

---

## 2\. Budget sections (סעיפים תקציביים) — execution packages, not blue-book chapters

Budget control in contractor firms runs on work packages; the BOQ runs on blue-book chapters (פרקי המפרט הכללי). The demo shows both, and that's realistic: the drainage line is "פרק 57" in the BOQ and lands in section 07 in the budget.

| \# | Section | Budget | Recorded to 1.9 | Committed (contract) | Prev. forecast (1.8) | New forecast (1.9) |
| :---- | :---- | ----: | ----: | ----: | ----: | ----: |
| 01 | ארגון אתר, מנוף, שמירה ושירותי אתר | 1,900,000 | 1,250,000 | — (standing POs) | 1,950,000 | 1,950,000 |
| 02 | שלד — עבודה ובטון (קבלן משנה) | 12,600,000 | 8,400,000 | 12,600,000 | 12,600,000 | 12,600,000 |
| 03 | אספקת ברזל זיון | 3,000,000 | 1,800,000 | framework \+ PO 2291 | 3,000,000 | **3,240,000** |
| 04 | עבודות עפר, דיפון וכלונסאות | 2,900,000 | 2,850,000 | 2,850,000 (closed) | 2,850,000 | 2,850,000 |
| 05 | איטום | 900,000 | 320,000 | 900,000 | 900,000 | 900,000 |
| 06 | בנייה (בלוקים) וטיח | 2,400,000 | 180,000 | 2,400,000 | 2,400,000 | 2,400,000 |
| 07 | פיתוח ותשתיות חוץ | 3,200,000 | 2,280,000 ¹ | 3,200,000 | 3,200,000 | **3,320,000** |
| 08 | אינסטלציה ותברואה | 2,300,000 | 350,000 | 2,300,000 | 2,300,000 | 2,300,000 |
| 09 | חשמל ותקשורת | 2,600,000 | 280,000 | 2,600,000 | 2,600,000 | 2,600,000 |
| 10 | מיזוג אוויר | 1,500,000 | 0 | 1,500,000 | 1,500,000 | 1,500,000 |
| 11 | אלומיניום | 2,000,000 | 0 | 2,000,000 (signed 25.8) | 2,000,000 | 2,000,000 |
| 12 | ריצוף וחיפוי | 2,700,000 | 0 | — estimate | 2,700,000 | 2,700,000 |
| 13 | נגרות, מסגרות ומעקות | 1,700,000 | 0 | — estimate | 1,700,000 | 1,700,000 |
| 14 | מעליות | 1,300,000 | 260,000 | 1,300,000 | 1,300,000 | 1,300,000 |
| 15 | צבע וגבס | 1,100,000 | 0 | — estimate | 1,100,000 | 1,100,000 |
| 16 | מערכות חניון (שערים, אוורור, כיבוי) | 1,200,000 | 0 | — estimate | 1,200,000 | 1,200,000 |
| 17 | בלתי צפוי | 1,500,000 | 0 | — | 1,500,000 | 1,500,000 |
| 18 | הנהלה, פיקוח, ביטוח ואגרות | 3,200,000 | 2,100,000 | — | 3,200,000 | 3,200,000 |
|  | **Total** | **48,000,000** | **20,120,000** |  | **48,000,000** | **48,360,000** |

¹ 2,100,000 before invoice 1147 is corrected; 02-שלד shows 8,580,000 until then.

Previous forecast nets to exactly 48.0M via two small, explainable variances (site organisation \+50K for schedule, earth/piling −50K closed under budget). The scene-7 trend line: 1.5: 47.90 · 1.6: 47.95 · 1.7: 48.00 · 1.8: 48.00 · 1.9: 48.36.

**Per-building split (scene 7, change 2):** shell, steel, block work, aluminium, tiling, carpentry, paint, HVAC, plumbing, electrical split A/B by floors cast and planned quantities; earthworks, development, parking systems, elevators (2 per building — split), site org and overhead go to "משותף". Invoice 1147 has no building tag → "משותף", which the system says out loud.

---

## 3\. Contracts (11) — `contracts.csv` \+ `contracts/*.json`

| Contract | Section | Counterparty | Amount | Signed | Notes |
| :---- | :---- | :---- | ----: | :---- | :---- |
| 02-01 | 02 | ב.מ. בנייה מהירה בע״מ | 12,600,000 | 20.10.2025 | Shell labour \+ concrete. Steel supplied by client (אספקת ברזל ע״י המזמין). Elevators, aluminium excluded — covered elsewhere (a *legitimate* exclusion the engine must not flag). |
| 04-01 | 04 | ע. דורון עבודות עפר | 2,850,000 | 15.10.2025 | Closed 30.4.2026, final account approved. |
| 07-01 | 07 | נ.ת.ב. תשתיות ופיתוח בע״מ | 3,200,000 | 5.1.2026 | Site development, covers all BOQ chapter-57 lines including the outdoor drainage line at first. **§3.4 exclusions:** water-connection fees, public-road paving. |
| 05-01 | 05 | איטום פלוס | 900,000 | 12.1.2026 | BOQ ch. 05 fully matched → the "positive finding". |
| 14-01 | 14 | מעליות אורן | 1,300,000 | 3.3.2026 | 4 elevators; 20% advance paid. |
| 08-01 | 08 | ש.י. אינסטלציה | 2,300,000 | 18.5.2026 |  |
| 09-01 | 09 | חשמל א.ר. | 2,600,000 | 18.5.2026 |  |
| 06-01 | 06 | גל בנייה קלה | 2,400,000 | 2.6.2026 | Blocks \+ plaster. |
| 10-01 | 10 | קור-אויר מערכות | 1,500,000 | 14.7.2026 |  |
| 11-01 | 11 | אלומיניום גלעד | 2,000,000 | 25.8.2026 | This is the "windows order" that closed from the 1.8 open issues. |
| 03-F | 03 | פלדות הצפון בע״מ | framework, no fixed amount | 1.11.2025 | Price appendix A: 4,000 ₪/t. **Appendix A-2 from 15.7.2026: 4,800 ₪/t.** |

Company names are invented but *look* Israeli. Before the meeting I recommend a 5-minute check on רשם החברות for collisions, and a discreet footer on each PDF: ״מסמך הדגמה — נתונים בדויים״. Your call — I'll include the footer as a toggle in the generator.

---

## 4\. Supplier invoices (\~215) — `invoices.csv`

Subcontractors bill **cumulative progress accounts** (חשבון חלקי מס׳ N, חשבון עסקה), not retail invoices. A PM will look for this. Fields:

`invoice_id, supplier, supplier_doc_no, doc_type (חשבון חלקי / חשבונית מס / חשבון סופי), partial_no, period, date_received, section, contract_id, po_id, description, amount_this (excl. VAT), cumulative_prev, cumulative_now, retention_pct, retention_amt, net_payable, building (A/B/משותף/null), status (אושר / בבדיקה / שולם), approved_by, entered_by, attachment`

Generation rules, so the totals in §2 reconcile exactly:

- Shell (02-01): monthly partials 1–10, Nov 2025 → Aug 2026, cumulative 8,400,000; retention 5%.  
- Steel (03-F): \~18 delivery invoices, 450 t total at 4,000 ₪/t \= 1,800,000; last delivery 28.8.2026 against **PO 2240** (60 t, issued 1.7.2026 at 4,000 — old price, legitimately: issued before appendix A-2). Quantities in the invoices are in **tons**, consistent.  
- Development (07-01): partials 1–7. **Partial 7 \= invoice 1147**: 180,000, received 31.8, "עבודות עפר וקווי ניקוז — פיתוח חוץ, שלב א׳". In the seed data it is correctly on 07; scene 1 (variant A) moves it to 02 live. Change log row pre-seeded: created 2.9.2026 by שרית, section 07\.  
- Earth/piling: partials 1–6 \+ final account.  
- Waterproofing: 3 partials. Elevators: advance invoice. Plumbing/electrical: 2 partials each. Blocks: 1 partial.  
- Site services: monthly invoices from crane rental, guarding, toilets, scaffolding/formwork rental, water/electricity, testing lab, surveyor (\~90 small invoices, section 01).  
- Overhead (18): monthly allocations (management, insurance, fees) — 10 rows.  
- Count target 210–220; all statuses realistic (a few בבדיקה in the last two weeks).

**Trap rows (must NOT be flagged):** crane-rental invoice in 01 with description ״מנוף צריח — שלד בניין A״; a steel invoice with quantity in kg *and* unit kg (consistent); an elevator advance without a BOQ quantity yet.

---

## 5\. Purchase orders (38 open) — `purchase_orders.csv`

`po_id, date, supplier, section, contract_id, description, qty, unit, price_unit, unit_price, amount, delivered_qty, invoiced_amount, status, attachment`

`unit` is the unit the quantity is measured in; `price_unit` is the unit the price is quoted in. The order is worth the quantity converted into `price_unit`, times `unit_price` — so a supplier who quotes 4,800 ₪ לטון and delivers 12,000 ק״ג is recorded as keyed, and the order is still 57,600 ₪. Seeded orders all have `price_unit` \= `unit`; the correction of PO 2291 may use either form.

- **PO 2291** — 22.8.2026, פלדות הצפון, ״ברזל זיון מצולע, קטרים 8–16 מ״מ״, qty **12,000**, unit **טון**, unit price **4.80**, amount 57,600. Attachment: supplier quote (12,000 kg \= 12 t × 4,800). This is the unit-error finding; the amount is right, the qty/unit/price fields are in kg against a ton unit.  
- PO 2240 — closed, 60 t at 4,000, delivered in full (trap: old price, legitimate).  
- \~36 others: standing/blanket orders for site services, formwork rental, concrete pumps, lab tests, block deliveries, waterproofing materials, safety consultant, etc. Quantities and units consistent.

---

## 6\. BOQ v4 (12.8.2026) — `boq.csv`

Blue-book chapters, contractor's design quantity list (not a tender BOQ). \~120 lines. Chapters: 01 עבודות עפר · 02 בטון יצוק באתר · 04 בנייה · 05 איטום · 06 נגרות ומסגרות · 07 תברואה · 08 חשמל · 09 טיח · 10 ריצוף וחיפוי · 11 צבע · 12 אלומיניום · 15 מיזוג · 17 מעליות · 22 גבס · 23 כלונסאות · 40 פיתוח האתר · 51 סלילה · **57 קווי מים, ביוב וניקוז**.

Key line: `57.03.040 — צינור ניקוז PVC קשיח SN8 קוטר 400 מ״מ, כולל חפירה, מצע ומילוי, עומק עד 2.5 מ׳ — 80 מ׳ — הערה: קו ראשי עד נקודת החיבור העירונית`. At seed it is `coverage: covered`, `coveredByContractId: 07-01` — same as its chapter-57 siblings; the gap only surfaces once `boq_v5_ch57.pdf` (see §8) is processed.

Steel appears in chapter 02 as ״מוטות פלדה מצולעים לזיון — 750 טון״ (quantities total → ties to the 3.0M budget at 4,000).

Each BOQ chapter maps to a section and to a contract coverage flag: covered / excluded (§ref) / not yet contracted. Chapter 05 fully covered → positive finding. Chapter 17 excluded from shell but covered by 14-01 → trap, not a gap. Line 57.03.040 stays `covered` in the record even after the gap is found — the check reads it from `boq_v5_ch57.pdf`'s recorded facts (`removedLineIds`), not from the line's own `coverage` field.

---

## 7\. Forecasts — `forecast_2026-08-01.json`, `forecast_2026-09-01.json` (+ 3 earlier totals-only)

Per section: budget, recorded, committed, remaining-to-complete lines (each line: description, qty, unit, unit\_price, amount, basis \= contract / PO / estimate, source doc). Steel remaining line in 1.8: 300 t × 4,000, basis \= ״נספח א׳ (11/2025)״ — the stale price. Development package in 1.8: coverage \= ״מכוסה בחוזה 07-01״, additional estimate 0\.

Open issues carried from 1.8 (3): שינוי מס׳ 2 בחוזה השלד — closed 18.8 · חתימת חוזה אלומיניום — closed 25.8 · אישור תאגיד/עירייה לחיבור ביוב — open.

**Scene 9 "still estimate" answer, corrected to the data:** \~8.2M — four uncontracted packages (12, 13, 15, 16 \= 6.7M), steel balance 288 t (1,382,400), drainage line (120,000). The 637,600 "finishes phase B" line in the current script is dropped.

---

## 8\. Documents (PDF, Hebrew, scanned look) — `docs/`

| File | What it is | Realism details |
| :---- | :---- | :---- |
| `inv_1147_ntb_partial7.pdf` | חשבון חלקי מס׳ 7 — חשבון עסקה, נ.ת.ב. תשתיות | Cumulative table (מצטבר קודם / מצטבר נוכחי / חשבון זה), 5% retention, sections of work with quantities, project manager approval box, stamp. |
| `quote_pladot_12t.pdf` | הצעת מחיר / אישור הזמנה, פלדות הצפון, 20.8.2026 | ״12,000 ק״ג (12 טון) × 4,800 ₪/טון \= 57,600 ₪״, delivery to site, payment terms שוטף+60. |
| `appendix_A2_steel_price_2026-07-15.pdf` | נספח א׳-2 למסגרת 03-F | Price table by diameter, base 4,800 ₪/t, validity, index clause, signed by both. Replaces appendix A (4,000). |
| `contract_07-01_excerpt.pdf` | חוזה קבלנות משנה 07-01 — עמ׳ 3–4, סעיף 3 היקף העבודות | §3.3 included works, now including the outdoor drainage line; **§3.4 exclusions** are water-connection fees and public-road paving only. |
| `quote_ycohen_drainage.pdf` | הצעת מחיר, י. כהן תשתיות, 20.8.2026 | Ø400 SN8, 80 m, 1,500 ₪/m incl. excavation/bedding/backfill up to 2.5 m; excludes municipal connection fee; valid 30 days. |
| `boq_v4_ch57.pdf` | כתב כמויות גרסה 4 — פרק 57 | One page, the drainage line present and highlighted. |
| `boq_v5_ch57.pdf` | כתב כמויות גרסה 5 (2.9.2026) — פרק 57, עדכון | Same chapter, drainage line (57.03.040) dropped from the table, with a note that it moved to a later phase. Seeded **unprocessed** (no `facts`/`factsSource`) — the agent must read it before the coverage finding can fire. |
| `appendix_A_steel_price_2025-11.pdf` | Original appendix (4,000) | So the "old price" has a source too. |

Also ERP-screen records (not PDFs): PO 2291, invoice 1147 header, contract 07-01 header, change log.

---

## 9\. Realism traps the engine is tested against — `SPEC.md §Tests`

Must fire (4): invoice 1147 on 02 · PO 2291 unit mismatch · steel remaining at 4,000 vs appendix A-2 · BOQ 57.03.040 still recorded as covered by 07-01 once `boq_v5_ch57.pdf` is processed and shows the line removed, with no estimate. (Before that document is processed, only 3 of the 4 fire — the coverage gap is document-driven, not pre-seeded.)

Must NOT fire (5): PO 2240 old price (pre-dates appendix) · crane invoice "שלד" text in 01 · elevators excluded from shell but covered by 14-01 · steel invoice in kg/kg · earth/piling closed under budget (variance, not an error).

---

## 10\. Package layout for Claude Code

hadarim-demo/

  SPEC.md                 ← build spec: entities, screens, checks, tests, demo flow

  DEMO\_SCRIPT.md          ← the approved script (updated numbers)

  data/

    project.json, sections.csv, contracts.csv, invoices.csv,

    purchase\_orders.csv, boq.csv, change\_log.csv, suppliers.csv,

    forecast\_2026-05..09.json, open\_issues.csv

  docs/                   ← the 7 PDFs

  contracts/              ← 11 contract JSONs (scope, inclusions, exclusions, terms)

  generate/               ← the Python generator, so numbers can be re-tuned

Ziv terminology: I'll use Ziv-style vocabulary as far as I know it (פרויקט / סעיף תקציבי / חשבון חלקי / הזמנת רכש / חוזה קבלן משנה / תחזית לגמר). I don't have a Ziv screen in front of me — if you can send one screenshot of a Ziv invoice or PO screen, I'll match field names and order exactly. Otherwise the mock will be "Ziv-flavoured", which a Ziv user will notice.

---

## Decisions I need from you

1. Approve the section table and 20.1M recorded (→ script edits).  
2. Company names: keep, or send me real-sounding ones you prefer. Footer ״מסמך הדגמה״ on PDFs: yes/no.  
3. Ziv screenshot: yes/no.

