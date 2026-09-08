# Hadarim demo v2 — engineering handoff plan

Written 2026-09-08 after reading the three new specs. Purpose: let a fresh session build v2 without re-deriving the reconciliation below. Read this first, then the three specs, then the code map at the end.

## 1. Sources and precedence

| File | Role | Precedence |
| --- | --- | --- |
| `hadarimdataspec.md` | Entities, numbers, generation rules, traps, package layout | 1 (numbers win) |
| `hadarimdemoscript.md` | 9 scenes, UI shape, Hebrew copy, presenter flow | 2 (flow and copy win) |
| `budgetcontrolreportstandard.md` | Report structure (sections 0–11), definitions, disqualifier checklist, CEO one-pager | 3 (report engine spec) |
| `Construction_AI_Demo_Build_Brief.md` | The v1 brief. Keep only its engineering conventions (integer agorot, immutable sources, review before write, frozen reports, deterministic adapter boundary) | 4 |

v2 is a different product surface from v1, not an increment: one project ("הדרים", 48.0M budget, 18 budget sections), a simulated ERP the presenter edits live, and a conversation-centric control system whose report is a living document. WhatsApp clarifications, alerts by role and recurring tasks are explicitly "next phase" in the script's closing line and are out of scope for v2.

## 2. Reconciled numbers (data spec §2 is authoritative)

Project: אופק ביצוע בע״מ · הדרים · 2 buildings (A, B), 8 floors × 3 units = 48 units (the script's "72 יח״ד" is superseded), shared 2-level parking · execution start 2.11.2025 · budget 48,000,000 excl. VAT, version 3 approved 15.3.2026 · controls 1.5, 1.6, 1.7, 1.8.2026, current 1.9.2026 · people: אייל (PM, operates the demo), רועי (VP execution), דנה (CEO), שרית (bookkeeping, change log only).

Budget sections (₪): 01 ארגון אתר 1,900,000 (recorded 1,250,000; forecast 1,950,000 both controls) · 02 שלד 12,600,000 (8,400,000; contract 02-01 12,600,000) · 03 ברזל 3,000,000 (1,800,000 = 450 t × 4,000; forecast 3,000,000 → **3,240,000**) · 04 עפר ודיפון 2,900,000 (2,850,000, closed final account, forecast 2,850,000) · 05 איטום 900,000 (320,000) · 06 בנייה וטיח 2,400,000 (180,000) · 07 פיתוח 3,200,000 (2,280,000 incl. invoice 1147; forecast 3,200,000 → **3,320,000**) · 08 אינסטלציה 2,300,000 (350,000) · 09 חשמל 2,600,000 (280,000) · 10 מיזוג 1,500,000 (0) · 11 אלומיניום 2,000,000 (0; contract signed 25.8) · 12 ריצוף 2,700,000 (0; estimate) · 13 נגרות 1,700,000 (0; estimate) · 14 מעליות 1,300,000 (260,000 advance) · 15 צבע וגבס 1,100,000 (0; estimate) · 16 מערכות חניון 1,200,000 (0; estimate) · 17 בלתי צפוי 1,500,000 (0) · 18 הנהלה 3,200,000 (2,100,000). Budgets sum to 48,000,000. Previous forecast nets to 48,000,000 (01 +50,000, 04 −50,000). New forecast 48,360,000 (+360,000, 0.75%).

**Discrepancy to settle:** the recorded column sums to 20,070,000, not the 20,120,000 the spec prints. Proposed default: keep every section value, state the total as 20,070,000, and keep the script's rounded "20.1 מ׳". Alternative: raise 01 recorded to 1,300,000.

Derived checks the generator must satisfy:

- Steel: BOQ 750 t; delivered 450 t (18 invoices at 4,000 incl. the last delivery 28.8 against PO 2240, 60 t at 4,000, legitimately pre-appendix); remaining 300 t; PO 2291 (22.8) 12 t at 4,800 = 57,600 sits inside the 300 t; new forecast 1,800,000 + 300 × 4,800 = 3,240,000; still-estimate steel after the demo = 288 t = 1,382,400 (the standard's "228 טון חשופים" is a typo for 288).
- Development: after correction recorded 2,280,000 (partials 1–7, partial 7 = invoice 1147, 180,000, 31.8, entered 2.9 by שרית on 07); committed 3,200,000; remaining commitment 920,000; uncovered estimate 120,000 (drainage quote י. כהן 20.8, 80 m × 1,500, valid 30 days → 19.9); EAC 3,320,000. Before correction (scene 1 variant A) 02 shows 8,580,000 and 07 shows 2,100,000; totals unchanged.
- Still-estimate items (scene 9 reserve answer): packages 12, 13, 15, 16 = 6,700,000 + steel 1,382,400 + drainage 120,000 ≈ 8,202,400. The script's 637,600 "finishes phase B" line is dropped.
- Status ratios for the report: physical ~38%, expense 42% (20.07 / 48.36), commitment ~78%.
- Trend: 47.90 → 47.95 → 48.00 → 48.00 → 48.36.
- Open issues carried from 1.8: three; closed 18.8 (change #2 shell contract) and 25.8 (aluminium contract); open since 07/2026: municipal sewer connection approval (highlighted as open two controls). New after the demo: PO 2291 fix (רועי, awaiting execution) and drainage order (אייל, by 19.9).
- Contingency 1,500,000 unused; the executive summary must include the decision "fund the 360,000 from contingency or show as overrun".
- Indexation: one explicit sentence in appendix ב׳ (the standard asks for it).

Must fire (4): invoice 1147 on 02 (allocation vs contract scope, supplier history, change log) · PO 2291 qty 12,000 / unit ton / price 4.80 vs quote 12 t × 4,800 · steel remaining priced 4,000 vs appendix A-2 4,800 from 15.7.2026 · BOQ 57.03.040 excluded by contract 07-01 §3.4 with no estimate.
Must not fire (5): PO 2240 at the old price · crane invoice in 01 whose text says "שלד" · elevators excluded from shell but covered by 14-01 · a steel invoice in kg with unit kg · earth/piling closed under budget (variance, not an error).

## 3. Product surface

Two screens, switchable in one app:

1. **מערכת המידע (ERP מדומה)**, Ziv-flavoured vocabulary: lists and forms for חשבונות ספקים (view / edit / new; section from a dropdown; attachment; per-record change log), הזמנות רכש, חוזי קבלני משנה, תקציב/תחזית. The presenter's scene-1 edit (invoice 1147: 07 → 02, variant A) or new-invoice entry (variant B) really changes the data the control reads.
2. **מערכת הבקרה**: chat in the center (Eyal writes; the system answers with progressive checklist steps, 2–3 s apart, skippable), findings board on the side, report area that opens once all findings are handled, configuration save, Q&A on the finished control.

Finding card, always the same four blocks: הבעיה · המקורות (each opens the record or the document page, relevant field highlighted) · המשמעות · ההחלטה הנדרשת (buttons plus free text). Decision routes: `[עדכן]` (permission check → write → re-read verification → before/after log), `[העבר להנהלת חשבונות]`, `[רק בתחזית]`, `[העבר לרועי לביצוע]` (finding stays "ממתין לביצוע" until verified in the ERP). Free-text answers must work for scene 6 ("צריך להזמין אותו. יש הצעה עדכנית בתיקיית הפרויקט." → folder search → quote found → add as estimate, not commitment → task with owner and due date).

Report engine per the standard: sections 0–11, 4א forecast changes versus 4ב data corrections (must reconcile to the summary), materiality threshold in the appendix, basis column (% covered by commitment), contingency as its own row, positive findings phrased as "נבדק ונמצא תואם", trend charts (four at most). Live operations from chat: add the comparison section (7), re-split section table by building (A / B / חניון / משותף; invoice 1147 has no building tag → "משותף", said out loud), CEO one-page version linked to the same control version, export PDF / Word, save configuration ("תצורת בקרה — הדרים", structure only, no data).

Q&A intents (scene 9 plus reserve): what changed versus the previous control (with the price-versus-quantity decomposition), which previous issues closed, what is still estimate-based, why development rose by more than 120,000.

## 4. Reuse map from the v1 code

Reuse as-is or lightly adapted: `src/domain/money.ts`, `src/domain/dates.ts`, `src/export/xlsx.ts`, the store/persistence/session pattern in `src/app/store.ts`, `src/components/primitives.tsx`, `Drawer.tsx`, the CSS system in `src/styles/`, the DocumentViewer idea (documents as immutable HTML pages with anchors and a "scanned" look), the audit/history list, `IntelligenceAdapter` boundary, Playwright and vitest setup, the Pages workflow.

New for v2: the data model (sections, contracts with inclusions/exclusions, BOQ lines with coverage flags, cumulative partial accounts with retention, POs, forecast versions with per-line basis, change log, open issues, buildings), a deterministic generator for ~215 invoices / 38 POs / ~120 BOQ lines committed as JSON next to the generator, the four checks and five traps, the chat-driven control flow, the findings board, the report engine with restructuring and the CEO version, exports, configuration save, and the ERP screens with a real change log.

Decision recorded as default: v2 lives beside v1 in the same repo (own entry route, shared utilities), so the sixteen-scenario demo keeps working until the user decides to retire it.

## 4b. Phase 1 status (done 2026-09-08)

- `src/hadarim/data/` holds the deterministic generator (`generate.ts`), the seven document pages (`documents.ts`) and the types. `npm run hadarim:dump` writes JSON/CSV to `data/hadarim/` for inspection; the app imports the generator directly.
- `src/hadarim/engine/checks.ts` implements the four checks and the verified-match positive. `tests/hadarim.data.test.ts` pins every number in §2, the pre/post scene-1 states, the must-fire set and the five traps.
- Modelling decisions taken: demo day is 3.9.2026 (invoice 1147 was keyed in on 2.9; control label stays "1.9.2026" with data received through 31.8); recorded total 20,070,000; blanket site-service orders cover 15 months and the site plan is 16 months, so section 01 shows a small schedule-extension estimate line; PO 2240 appears as a committed line only in the 1.8 forecast (delivered by 1.9); the 1.9 draft carries the 300 t × 4,000 line with PO 2291 inside it, so the headline moves 48.00 → 48.24 → 48.36 exactly as scripted.

## 4c. Phases 2–6 status (done 2026-09-08)

Everything in §5 is built, tested and committed on `main`. Entry: `hadarim.html` (second Vite input; `src/hadarim/main.tsx`).

- Engine (`src/hadarim/engine/`): `model.ts` (session, decisions, typed forecast adjustments per standard §4a, corrections, tasks, report config), `forecast.ts` (working forecast = rolled 1.9 draft + live recorded amounts + adjustments), `commands.ts` (pure commands: ERP edits with change log, `startControl`, progressive steps, `decide` / `route` / `confirmQuote` with permission check, write-back and re-read verification, audit, report config, save, finalize), `report.ts` (`buildReport` → full `ReportModel`, sections 0–11 + CEO page), `conversation.ts` (intents for scene 7 requests, scene 8 save and scene 9 questions). `tests/hadarim.engine.test.ts` walks the whole script: 48.00 → 48.24 → 48.36.
- Store and shell (`src/hadarim/app/store.ts`, `src/hadarim/App.tsx`): persisted domain state (`hadarim-v2`) and UI state (`hadarim-v2-ui`); presenter strip (screen switch, ללא אנימציה, scene-1 variant, two-step reset); shared document viewer (`src/hadarim/components/DocumentView.tsx`).
- Screens: `features/erp/` (זיו-flavoured ERP: invoices with edit/new forms and per-record change log, POs with amount-locked correction, contracts with exclusions and appendices, budget/forecast, change log), `features/control/` (chat with steps, finding cards, decision routes, control board, record modal), `features/report/` (living report, print CSS, CEO tab, config chips, exports) and `src/hadarim/export/docx.ts` (real `.docx`, RTL, via the `docx` package). `e2e/hadarim.spec.ts` runs scenes 1–9 through the UI; `e2e/hadarim.visual.spec.ts` takes element screenshots (`e2e/screenshots/hadarim-v-*.png`) and covers scene-1 variant B and the PO guard.
- Decisions taken while building: report section numbering follows the standard (0 כותרת … 4 שינויים with 4א/4ב, 5 סעיפים מהותיים … 11 נספחים); the unit finding's default script route is "העבר לרועי לביצוע", so the PO stays uncorrected in the ERP and the comparison shows 3 → 3 open issues (choose [עדכן] to get 3 → 2); an issue is "פתוח יותר משתי בקרות" when it has been open at three or more controls including the current one; materiality = 100,000 ₪ and 3 % of the section, or 250,000 ₪; scene-1 variant B assigns the next free invoice id (the seed already contains 1147) and its prefill button keys the same values into 02-שלד; the chat's "send" action opens the report pane (no simulated mailbox in v2); contract id "03-F" is wrapped in bidi isolates wherever it appears inside Hebrew prose.

## 4d. Spec re-check after the build (2026-09-08, later the same day)

A line-by-line re-read of the three specs against the built product found ten gaps; all are fixed and covered by tests:

1. "Still estimate" figure now follows data spec §7: after the price decision the 12 t on PO 2291 become a commitment line (57,600) and 288 t stay uncovered at 4,800 (1,382,400); overhead and contingency lines carry basis `allocation` and are shown separately (appendix ז, second table) instead of being counted as estimates. Uncovered-estimates total = 6,700,000 + 1,382,400 + 120,000 + 75,000 (site-organisation extension) = 8,277,400; the scene-9 answer lists the three spec groups plus the extension line.
2. Material sections (standard §5) are generated for every section over the threshold, over 10 % of budget, or with basis below 70 %: 02, 03, 07, 12, 13, 15, 16, 18 — each with reason, contract/order status, BOQ coverage, basis, "what can change", recommendation and source links.
3. Step pacing: 2.2 s between steps and 4.5 s on the checks line (script: 2–3 s, then ~5 s); "דלג" and ללא אנימציה unchanged.
4. Findings board shows the script's "השפעה משוערת על התחזית" column (estimate before the decision, applied amount after) and the owner on "ממתין לביצוע".
5. Per-building split carries the same columns as the sections table (budget, recorded, commitments, remaining, uncovered, forecast, variance ₪/%, basis) and the "[שנה]" affordance: tagging invoice 1147 with a building writes the ERP field with a change-log row and moves its 180,000 out of "משותף".
6. The CEO-version message carries [ייצוא PDF] [ייצוא Word] [שלח לדנה]; exports run from the chat through the report pane; "שלח לדנה" is a logged, audited simulated hand-off.
7. Scene 8 prompt states what is kept (structure) and what is never kept (data), per the script.
8. Traceability: material sections and appendix ז rows open their document page (at the anchor), ERP record or ERP screen (the invoice list pre-filtered by section).
9. Trends: uncovered-estimates series (1.8 → 1.9) with a data-driven explanation of the movement (aluminium contract signed, steel repriced, drainage added); still one chart.
10. Scene-1 variant B seeds the ERP without invoice 1147 and the keyed-in invoice receives that number, as the script states; switching the variant re-seeds the demo (with a confirmation once anything was touched).

Left as data-driven deviations from the script's copy: three open issues (the standard's own §8 lists three) and 24 new invoices since the previous control (the data spec's volumes).

## 4e. From demo to prototype: Supabase + a Claude agent (started 2026-09-08)

Direction set by the user after the demo was complete: the ERP data moves to a shared Supabase Postgres project (`aevdlzncwkdosbzkgpgy`, same database for local and hosted), the mock ERP reads and writes it, and the control system becomes a Claude Code agent that runs from this folder, using the deterministic engine as tools (checks, working forecast, report, corrections) plus the Supabase MCP for SQL. The browser chat stays until the agent replaces it.

Decisions (user, 2026-09-08): open access through the publishable key for now (RLS is enabled with one permissive policy per table, so tightening is a policy change); a "reset to seed" action; change log written by database triggers; everything keyed by `project_id` so more projects are rows.

Step 1 — done:
- `supabase/migrations/20260908210000_hadarim_schema.sql` (+ two follow-ups): reference tables (projects, people, suppliers, sections, documents, contracts), ERP tables (invoices, purchase_orders, boq_lines), forecast versions/sections/lines, open_issues, change_log with triggers on invoices and purchase_orders (`updated_by` / `update_note_he` columns carry the actor and note; seed inserts without an actor are not logged), control tables (controls, decisions, forecast_adjustments, data_corrections, audit, report_versions), a `seed` schema with `snapshot_project_seed()` and `reset_project()`, grants for the Data API (tables are no longer auto-exposed since 2026-04-28), FK indexes.
- `scripts/seed-supabase.ts` (`npm run hadarim:seed`) loads the deterministic package and takes the seed snapshot; `scripts/reset-supabase.ts` (`npm run hadarim:reset`) restores it. `npm run db:types` regenerates `src/hadarim/db/types.ts`. Connection constants in `src/hadarim/db/config.ts` (publishable key is public by design; a secret key is never committed).
- Verified against the project: 216 invoices (5 in review), recorded 20,070,000, section 07 = 2,280,000, 38 open POs, 118 BOQ lines, draft EAC 48,000,000, 5 change-log rows; a SQL edit of invoice 1147 produced the trigger row "סעיף תקציבי 07-פיתוח → 02-שלד by SARIT" and `reset_project` restored the seed. Security advisor clean.
- Generator fix: `forceSum` now spreads the residual proportionally (one site-service invoice had gone negative); totals unchanged, one pinned trend value updated.

Step 2 — done: `src/hadarim/db/client.ts` loads a project as the engine's package and persists ERP writes (attributed through `updated_by`); the store bootstraps from the database, persists the ERP diff of every command and re-reads the trigger-written change log, follows Realtime changes, and resets through `reset_project()`. Offline mode (`?offline=1` or the `hadarim-offline` flag) keeps the browser-only generator data; the Playwright suites run offline. Opt-in live tests: `RUN_DB_TESTS=1` (round trip: database package equals the generator's; engine gives the same findings and totals) and `RUN_DB_E2E=1` (browser edit → trigger row → control sees it → reset).

Step 3 — done: `scripts/bakara.ts` (`npm run bakara -- …`) is the engine as a command-line toolset over the database: status, reset, ERP writes, control run/show, decide/route/quote, config, report (Markdown + Word + saved `report_versions` row), ask, finalize. `src/hadarim/db/session.ts` rebuilds the engine state from the database (controls, decisions, adjustments, corrections, tasks, audit) and saves it back after each command; the verification line after a write is a genuine re-read from the database. `src/hadarim/export/markdown.ts` renders the report for the agent to read. The whole script ran through the CLI against the live project (48.00 → 48.24 → 48.36, report version #1).

Step 4 — done: `.claude/agents/bakara.md` (the בקרה agent) and skills `/bakara-control`, `/bakara-report`, `/bakara-qa`, `/bakara-erp`, `/bakara-reset`. `CLAUDE.md` is the developer guide: a normal session develops; only the agent is the controller (user correction on 2026-09-08: the first version had put every session into controller mode).

Step 5 — done (2026-09-08/09): the tool surface became a general-purpose MCP server, and the engine lost its demo hard-coding.
- `src/hadarim/tools/index.ts` — 39 tools with zod schemas over any `project_id`: reads (`list_projects`, `get_project`, `get_control`, `get_forecast`, `get_section`, `query_invoices`, `query_purchase_orders`, `list_contracts`/`get_contract`, `query_boq`, `list_suppliers`/`get_supplier`, `query_change_log`, `list_issues`, `list_people`, `search_documents`/`get_document`, `get_audit`, `list_report_versions`), checks (`run_check` without saving, `run_control`), decisions (`decide_finding`, `route_finding`, `confirm_quote`), attributed writes (`reallocate_invoice`, `correct_purchase_order`, `set_invoice_building`, `create_invoice` — with `asCorrection` to distinguish the controller's §4b correction from plain ERP data entry), control shaping (`add_forecast_adjustment`/`remove_…`, `open_task`, `set_task_status`, `add_control_note`/`remove_…`, `set_project_status`, `set_report_config`), `build_report` (summary / markdown / json / docx, optional saved version), `finalize_control`, `reset_project`. `mcp/bakara-server.ts` serves them over stdio (`npx vite-node mcp/bakara-server.ts`, registered in `.mcp.json`); `npm run bakara -- tool <name> [json]` is the shell passthrough.
- `src/hadarim/engine/operations.ts` — pure free-standing operations (adjustments, tasks, notes, instructed corrections) next to the finding-driven `commands.ts`.
- Engine generalisation: `checks.ts` works from documents' extracted `facts` (`quoteFacts`, `proposedOrderCorrection`, `findQuoteFor`, `carriedIssues`), `commands.ts` no longer names any invoice/order/document/supplier of the scenario (routes and owners come from people's roles; the coverage flow searches the folder and opens a task when no quote exists), `report.ts` derives events from the change log and appendices, risks from quote validity/appendix exposure/stale issues plus controller notes, schedule and physical progress from the project row, assumptions/sources/comparison rows from the data. Carried issues live in the session's task list (all `open_issues` rows), so the agent can close them.
- Schema: `controls.notes`, `projects.physical_progress_pct` / `schedule`, `data_corrections.finding_id` nullable; types regenerated; re-seeded.
- Verified: 90 vitest tests (new `tests/hadarim.tools.test.ts`: registry, operations, notes → report, permissions; opt-in MCP stdio round trip), the whole demo script through the tools on the live database (48.00 → 48.24 → 48.36, tasks OI-1..3 + TASK-1..3, report version saved, reset), MCP client smoke (39 tools, JSON schemas, errors as `isError`), security advisor clean.

Step 6 — done (2026-09-09, user chose "retire the text box" over embedding an LLM in the browser): `engine/conversation.ts` (regex intents and five canned scene-9 answers) is deleted. The control panel keeps the engine's messages, the finding cards with their decision buttons and free-text decisions, and the progressive steps; the control starts from a button; a footer points free questions to the agent (`claude --agent bakara`). Report structure changes, the CEO hand-off ("שלח ל<מנכ״ל>", logged) and the configuration save (with the standard's "what is kept / never kept" prompt) live in the report pane. The CLI lost `ask`. Scene 9 of the demo script is the agent's, and the e2e suite covers scenes 1–8 through the UI.

Next: (7) package `.claude/` + `mcp/` as a Claude Code plugin; a report viewer in the web app for saved `report_versions`; later: Supabase Auth and real RLS, more projects.

## 5. Build phases for the next session

1. Data package: generator + committed JSON + tests that assert every number in §2, the must-fire and must-not-fire sets, and the pre/post scene-1 states.
2. ERP mock screens with per-record change log and live edit (scene 1, both variants).
3. Control engine: checks, finding cards, decision routes, permission check, write-back with re-read verification, audit.
4. Report engine per the standard, comparison section, per-building split, CEO version, exports, configuration save.
5. Q&A intents and the two control versions (1.8 final, 1.9 in progress) plus three earlier totals.
6. Presenter polish: progressive steps with skip, document pages with the demo footer, Playwright run of the whole script.

## 6. Decisions — all defaults approved by the user on 2026-09-08

1. Coexist with v1 or replace it. Default: coexist.
2. Who generates the data package. Default: generate it here in TypeScript, deterministic, committed with the generator; no external zip needed.
3. The 20,070,000 versus 20,120,000 recorded total. Default: 20,070,000.
4. Company names and the "מסמך הדגמה — נתונים בדויים" footer on documents. Default: keep the names from the spec, footer on.
5. Ziv screenshot for field names. Default: Ziv-flavoured vocabulary without a screenshot.
6. Exports. Default: Word via a real `.docx` writer with RTL, PDF via a print stylesheet and the browser's print-to-PDF; no fake downloads.
7. Scene-1 variant. Default: variant A as the primary path, variant B available.
