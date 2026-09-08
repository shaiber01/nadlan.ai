# בקרה — Construction Budget Control AI Service, Interactive Demo

A standalone, Hebrew (RTL) interactive demo of an AI-enabled budget-control service for Israeli construction companies. It simulates a control layer around the customer's existing ERP ("זיו — סביבת הדגמה"), with deterministic rules, sixteen replayable scenarios, free exploration, simulated WhatsApp/email delivery, a frozen report archive with real `.xlsx` attachments, and a deterministic Hebrew Q&A assistant.

Everything is synthetic. There is no backend, no live AI, no API key, no real ERP, and no real message delivery. The persistent badge **סביבת הדגמה · נתונים סינתטיים** says so inside the app.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: financial fixtures and scenario transitions
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

Node 22 and npm are the only requirements. The build uses a relative base path, so `dist/` runs from GitHub Pages, any sub-folder, or a plain file server. `.github/workflows/deploy.yml` publishes `main` to GitHub Pages.

## Primary walkthrough (8–10 minutes)

1. Open **תמונת מצב**. The company has four active projects and one draft budget; **מגורי הדרים** is selected. Two findings are already under provider review: the conditional future steel-price risk and the missing equipment allocation.
2. Click **נסה הדגמה מודרכת** (overview, or **בקרת הצגה** in the header). The tour runs S04 → S06 → S07 → S01 on one carried-forward state, then loads S05 → S15, then S02. A dismissible Hebrew guide panel names each step and highlights the relevant control. The tour never clicks approvals for you.
3. Use the **role switch** (מנהל החברה / צוות הבקרה) to see both sides. Provider actions (releasing alerts and questions, approving corrections and forecasts, approving reports) live in the reviewer view; the manager answers the WhatsApp questions and receives reports.
4. Open **תרחישי הדגמה** to start, replay, or step through any of the sixteen scenarios independently. Each scenario loads its own named starting state; your free-exploration workspace is saved and restored with **חזרה למרחב החופשי**.

### Reset

**בקרת הצגה → אפס את נתוני ההדגמה** restores the canonical baseline and clears local storage. State is persisted in `localStorage` under `bakara-demo-v1` and keyed by the seed version; incompatible stored data is never rendered, the app offers **טעינת נתוני ההדגמה החדשים** instead.

**התקדם שבוע** advances the simulated clock (starting 07/09/2026 09:00, Asia/Jerusalem) and creates the due weekly report draft for provider review, once per project and period.

## Hadarim v2 — the chat-centric control demo (second surface)

A second, independent demo lives at `hadarim.html` (locally `http://localhost:5173/hadarim.html`, on Pages `<site>/hadarim.html`). One project (הדרים, 48.0M budget, 18 sections), a simulated contractor ERP ("זיו — סביבת הדגמה") the presenter edits live, and the control system ("בקרה") that prepares the 1.9.2026 control in a conversation and writes a living report per `budgetcontrolreportstandard.md`. Specs: `hadarimdemoscript.md`, `hadarimdataspec.md`; reconciliation and status: `docs/hadarim-v2-plan.md`.

The script (nine scenes, ~10 minutes):

1. **ERP** → חשבונות ספקים → invoice 1147 → עריכה → סעיף תקציבי 02-שלד, מבצע שרית → שמור. The change-log row appears on the record. (Variant B, chosen in the presenter strip: the ERP starts without 1147; חשבון חדש → מילוי לדוגמה → שמור assigns that number.)
2. **בקרה** → type "תכיני בקרה תקציבית להדרים". The data-gathering steps play (skip with "דלג" or the ללא אנימציה toggle), then "נמצאו 4 ממצאים … אחד מהם ברשומה ששונתה היום" → נעבור על הממצאים.
3. Allocation card (1147): כן, לפיתוח → עדכן. The system checks permission, writes the ERP, re-reads the record and logs the audit line.
4. Unit card (PO 2291, 12,000 "tons" at 4.8): כן, 12 טון → עדכן or העבר לרועי לביצוע.
5. Price card (steel remainder at 4,800): כן, על כל 300 הטון → +240,000 (headline 48.24). Coverage card (drainage line excluded by clause 3.4): type "צריך להזמין. יש הצעה בתיקייה" → the quote is found → כן, הוסף לתחזית כאומדן → +120,000 (headline 48.36) and a task for אייל until 19.9.
6. פתח את הדוח: the full report (draft), exports (ייצוא PDF = browser print, ייצוא Word = real `.docx`), סגור כגרסה סופית.
7. Back in the chat: "תוסיפי השוואה לבקרה הקודמת ומגמות", "תציגי את הטבלה לפי בניין" (the note on invoice 1147 offers "שנה" to tag it with a building), "תכיני גרסה לדנה — עמוד אחד" restructure the same report; the last message offers ייצוא PDF / ייצוא Word / שלח לדנה. Every material-section and appendix row links back to its document, record or ERP screen.
8. שמור תצורה saves the structure as "תצורת בקרה — הדרים".
9. Questions (suggestion chips): what changed, whether the steel overrun is quantity or price, which issues closed, what is still an estimate, why development rose.

The presenter strip switches screens, skips animation, picks the scene-1 variant and resets the demo (two-step). State persists in `localStorage` (`hadarim-v2`, `hadarim-v2-ui`). Everything is derived from `src/hadarim/data/generate.ts` (deterministic; `npm run hadarim:dump` writes CSV/JSON to `data/hadarim/`); checks in `src/hadarim/engine/checks.ts`; commands, working forecast, report model and conversation in `src/hadarim/engine/`; screens in `src/hadarim/features/`. Tests: `tests/hadarim.*.test.ts` (data, engine, docx) and `e2e/hadarim*.spec.ts` (the whole script through the UI, plus element screenshots in `e2e/screenshots/hadarim-v-*.png`).

## Where to change things

| What | Where |
| --- | --- |
| Product name, source-system label, badges, simulated senders | `src/config/branding.ts` |
| Shared Hebrew UI copy | `src/locales/he.ts` |
| Canonical seed: projects, cost codes, ledger records, commitments, forecast work items, generated documents | `src/data/seed.ts` |
| Literal source documents (invoices, contracts, quotes...) and scenario-only documents | `src/data/documents.ts` |
| Scenario fixtures, triggers, branches, guidance steps, completion predicates | `src/data/scenarios/definitions.ts`; tour order in `src/data/scenarios/tour.ts` |
| Financial semantics (A/C/R/EAC, payments, coverage) | `src/domain/selectors/financial.ts` |
| Report snapshots, prior-world reconstruction, deltas | `src/domain/selectors/snapshot.ts` |
| Domain commands (receive, analyze, review/apply, messages, reports, rules, experiment) | `src/domain/commands/*.ts` |
| Deterministic intelligence adapter: rule registry, clarification parsing, chat intents | `src/intelligence/deterministic/*.ts`; boundary in `src/intelligence/types.ts` |
| Excel workbook writer | `src/export/xlsx.ts` |
| Store, persistence, analysis scheduler, scenario sessions | `src/app/store.ts` |
| Screens | `src/features/*`; shared evidence/proposal/document components in `src/components/*` |

### Replacing the intelligence adapter

`src/intelligence/types.ts` defines `IntelligenceAdapter` (`analyzeRecord`, `analyzeDocument`, `answerQuestion`, `interpretClarification`). The deterministic implementation returns structured drafts (findings, proposals, questions, alerts) and Hebrew text; domain commands validate and apply them. A future AI provider can propose analyses or interpret text behind the same interface, but ledger math and write authorization stay in `src/domain`.

## Financial model (summary)

Per cost code: **EAC = A + C + R**, where A is recognized incurred cost (posted invoices, opening balances, certificates, approved unbilled accruals, credits), C is Σ max(0, commitment value − recognized against it), and R is the accepted forecast of uncommitted work items. Payments are tracked per record and shown separately. Every posted cost identifies the work item it fulfills, so an invoice consumes exactly the forecast it replaces. Conditional risks and opportunities are shown outside accepted EAC until a reviewed decision. Reports freeze lines, totals, notes, record ids and the document set available at their cutoff; "last report" resolves dynamically.

## Verification performed

- `npm test`: 48 assertions covering the Section 5.1 baseline checksum, the prior report reconstruction (H10 = 0 / 0 / 1,500,000), every scenario's expected numbers from Section 14.1 (S02 draft 5,090,000; S03 reclassification; S04 200 → 20; S05 6,086,000 / 4,018,000 and the 13,333.33 / 6,666.67 payment split; S06 6,250,000, 6,178,000 and the locked-order 6,190,000; S07 answer texts including the company-wide steel coverage sentence; S08 6,206,000; S09 80,000 / 300,000 / 700,000; S10 180,000 / 170,000 and 270,000 vs 320,000; S11 6,114,000; S12 6,108,000 → 6,106,000; S13 480,000 / 6,186,000; S14 700,000 / 6,206,000 and 30/04/2027; S15 260,000 / 140,000 and the 30,000/30,000 custom split; S16 192,000 and 6,154,000), failed-write/retry idempotency, duplicate-delivery and duplicate-schedule guards, stale-session analysis discard, fixture isolation, and a valid RTL workbook zip.
- `npm run test:e2e` (Playwright, Chromium, against the production build; 18 tests): every destination renders without runtime errors; the guided path S04 → S06 → S07 → S01 through the real UI (record save, review approval, alert release before any report, WhatsApp reply, forecast approval to 6,250,000, chat delta of +150,000 versus 31/08, report generation, approval, WhatsApp delivery, `.xlsx` download, weekly schedule); S05 invalid and valid replies; S03 failed write and retry followed by S09 on its own fixture; S11's single immutable invoice versus the corrected ERP entry; S02, S08, S09, S10, S12, S13, S14, S15 and S16 each started from the gallery and completed through their triggers, client replies and reviewer approvals; the S06 locked-order branch and scenario restart; restoration of the free-exploration workspace after a scenario; a 390 px mobile message center. Screenshots are written to `e2e/screenshots/`. The Pages workflow runs the unit tests and the build only (no browser download in CI).
- The store is exposed as `window.__bakaraStore` for read-only inspection in the browser console.

## Limitations

- Intelligence is rule-based and deterministic; supported questions and reply phrasings are listed in the app (fallback text explains the boundaries). There is no OCR, no arbitrary spreadsheet ingestion, no live ERP, no real WhatsApp or email.
- The Excel attachment is populated from the frozen snapshot with plain formatting (two sheets, RTL view, number format). It is a valid Office Open XML workbook, not a richly styled template.
- The financial model omits VAT, retention, financing, foreign currency, and a time-phased earned-value model, as the brief specifies.
- Opening balances are inspectable synthetic summaries; their historical detail is intentionally not simulated.
