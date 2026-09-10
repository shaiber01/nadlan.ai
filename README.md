# בקרה — Construction Budget Control AI Service

Two things live in this repository:

1. **The Hadarim prototype** — a shared Supabase database, a simulated contractor ERP in the browser, a Claude Code agent ("בקרה") that is the budget controller through a general-purpose tool server, real documents the agent reads, a heartbeat over everything new, and the control report on its own page. **How it all works: [`docs/system-overview.md`](docs/system-overview.md).** The section "Hadarim — the control prototype" below is the short version.
2. **The v1 demo** — the earlier, browser-only interactive demo described next (sixteen replayable scenarios, no database, no agent).

## v1 — the interactive demo

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

## Hadarim — the control prototype

The full description is `docs/system-overview.md`; this is the short version. An independent surface: one project (הדרים, 48.0M budget, 18 sections) in a shared database, and two pages — the simulated contractor ERP ("זיו — סביבת הדגמה", `hadarim.html`, hosted at `https://shaiber01.github.io/nadlan.ai/hadarim.html`) whose edits are written to the database, and **the control report** (`report.html`, hosted at `https://shaiber01.github.io/nadlan.ai/report.html`) — a live, read-only view of the control the Claude agent ("בקרה") runs and of the report it produces per `budgetcontrolreportstandard.md`, with the saved versions and PDF / Word / Excel exports. The ERP never links to the report; the report's source links open ERP records in a new tab. The v1 demo stays at `https://shaiber01.github.io/nadlan.ai/`. There is one budget controller, the agent; the web app does not run controls or take decisions. Specs: `hadarimdemoscript.md`, `hadarimdataspec.md`; reconciliation and status: `docs/hadarim-v2-plan.md`.

> The walkthrough below is the *demo scenario* — invoice 1147 on the wrong section, PO 2291 keyed in kilograms, the steel remainder at the superseded price, the revised BOQ page. Those errors live in `tests/fixtures/scenario.ts` and the tests inject them on top of the seed; no script stages them in the live database yet, so the agent has to be run against a project where they are present.

The script (scene 1 in the browser, scenes 2–9 with the agent, the report tab following live):

1. **ERP** → חשבונות ספקים → invoice 1147 → עריכה → סעיף תקציבי 02-שלד, מבצע שרית → שמור. The change-log row (written by a database trigger) appears on the record. (Variant B, chosen in the presenter strip: the ERP starts without 1147; חשבון חדש → key in the invoice → שמור assigns the next number.)
2. **Agent** (`claude --agent bakara`): "תכיני בקרה תקציבית להדרים". It runs the checks on the live data and brings the first card, reporting what it found and which of it sits on a record that changed today.
3. Allocation (1147): כן, לפיתוח → עדכן. The tool checks permission, writes the ERP, re-reads the record and quotes the verification.
4. Unit (PO 2291, 12,000 "tons" at 4.8): כן, 12 טון → עדכן or העבר לרועי לביצוע.
5. Price (steel remainder at 4,800): כן, על כל 300 הטון → +240,000 (48.24). Coverage (drainage line excluded by clause 3.4): "צריך להזמין, יש הצעה בתיקייה" → the quote is found → כן, הוסף לתחזית כאומדן → +120,000 (48.36) and a task for אייל until 19.9.
6. "תכיני את הדוח": the executive summary, 4א versus 4ב, the decision needed; the Word file on request. **דוח הבקרה** in the browser shows the same report, live.
7. "תוסיפי השוואה לבקרה הקודמת", "תציגי לפי בניין", "גרסה למנכ״לית": the report restructures; the browser follows. The note on invoice 1147 offers "שנה" to tag it with a building.
8. "שמרי את התצורה": what is kept (structure) and never kept (data); "סגרי כגרסה סופית" when the control is closed. Saved report versions are listed in the browser next to the live one.
9. Questions — what changed, whether the steel overrun is quantity or price, which issues closed, what is still an estimate, why development rose — answered from the tools with sources.

The presenter strip switches screens, picks the scene-1 variant, toggles offline work and resets to the seed (two-step; online it restores the database snapshot). Offline (`?offline=1`) the browser uses the generator data only. Everything is derived from `src/hadarim/data/generate.ts` (deterministic; `npm run hadarim:dump` writes CSV/JSON to `data/hadarim/`); checks in `src/hadarim/engine/checks.ts`; commands, operations, working forecast and report model in `src/hadarim/engine/`; screens in `src/hadarim/features/`. Tests: `tests/hadarim.*.test.ts` (data, engine, tools, quality, review, generic, units, heartbeat, budget, documents, docx), `e2e/hadarim*.spec.ts` (ERP and the viewer offline) and `e2e/hadarim.db.spec.ts` (`RUN_DB_E2E=1`: the whole loop on the live database — browser edit, control through the tools, viewer, saved version, reset — with element screenshots in `e2e/screenshots/hadarim-v-*.png`).

### Database (prototype)

The Hadarim data also lives in a Supabase Postgres project shared by local and hosted runs (`src/hadarim/db/config.ts` holds the URL and the publishable key; the secret key is never committed). Schema and triggers are in `supabase/migrations/`; the change log is written by database triggers whenever an invoice, a purchase order or a budget change is written with an actor; uploaded documents live in the Storage bucket `documents`.

```bash
npm run hadarim:seed    # load the deterministic data package and snapshot it as the seed
npm run hadarim:reset   # restore the seed and clear control sessions ("reset to seed")
npm run db:types        # regenerate src/hadarim/db/types.ts after a migration
```

Access is open through the publishable key for now (a prototype decision); RLS is on with a permissive policy per table, so restricting access later is a policy change.

### The agent ("בקרה")

The budget controller is a Claude Code agent defined in this repository, not the default session: `.claude/agents/bakara.md` holds the role and rules, the skills `/bakara-control`, `/bakara-report`, `/bakara-qa`, `/bakara-erp`, `/bakara-reset`, `/bakara-extract`, `/bakara-heartbeat` the procedures, and the `bakara` MCP server in `.mcp.json` the tools. A plain `claude` session here is a development session (see `CLAUDE.md`).

**Budget, chapters and documents.** The budget is the sections' original budget plus approved budget changes (transfers between sections, additions, reductions), keyed on the ERP's budget screen with the approver or recorded by the agent on instruction, logged, and shown in the report's "שינויים / תקציב מעודכן" columns; the variance is measured against the updated budget. Sections carry the chapters of the Interministerial Specification (הספר הכחול) and the report can add a view by chapter. Every record is also checked against its source document: the facts read from the document must match the record, and the card's proposed fix is the document's values.

**Real documents and the heartbeat.** The ERP's תיקיית מסמכים screen uploads real files (PDF, image, text) to the project folder (Supabase Storage); the agent can also take a file from the session (`add_document`). Uploading only stores the file: a document is *unprocessed* until the agent reads it — a PDF or image with its own eyes (`Read` on the local path `get_document` returns; the extracted text is a convenience) — describes it (`classify_document`) and records the facts the checks use (`set_document_facts`). `/bakara-heartbeat` is one pass over everything new since the previous one: pending documents, the ERP records inserted or changed since the last watermark (the change log), the checks' findings on them; it ends with a recorded heartbeat and a Hebrew summary. The report skill runs it first; `scripts/heartbeat.sh` runs it headless for a cron job (nothing is decided without a user); `npm run bakara -- heartbeat` prints the deterministic work list.

```bash
claude --agent bakara        # a whole session as the controller (approve the .mcp.json servers on first use)
# or, in a normal session: "use the bakara agent to run the control for הדרים"
```

The tools (`src/hadarim/tools/index.ts`, served by `mcp/bakara-server.ts`; 52 of them, listed by group in the overview) are general-purpose over any project in the database — reads (`get_project`, `get_forecast`, `get_section`, `query_invoices`, `query_change_log`, `search_documents`, …), checks (`run_check`, `get_heartbeat_work`), the control and its decisions (`run_control`, `decide_finding`, `route_finding`, `confirm_quote`, `raise_finding`, `record_review_pass`), attributed writes (`reallocate_invoice`, `correct_purchase_order`, `create_invoice`, `add_budget_change`, `add_forecast_adjustment`, `open_task`, `add_control_note`, `set_project_status`), documents (`add_document`, `classify_document`, `set_document_facts`), the heartbeat (`record_heartbeat`) and the report (`set_report_config`, `build_report`, `finalize_control`). The agent never computes numbers itself; every figure it quotes comes from a tool result, every write is attributed to the person who decided, logged by the database triggers and re-read as verification. The same registry is available from a shell:

```bash
npm run bakara -- tools                                     # list the tools
npm run bakara -- tool get_forecast '{"sectionId":"03"}'    # call one
npm run bakara -- control run                               # the demo-script commands still work
```

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
