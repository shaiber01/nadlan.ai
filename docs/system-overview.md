# nadlan.ai — how the system works

This is the one document to read first. It describes the Hadarim budget-control prototype as it is built today: the simulated ERP, the shared database, the documents, the budget, the Claude agent that acts as the budget controller, its tools and skills, the heartbeat, and the report. Status history and decisions are in `hadarim-v2-plan.md`; day-to-day developer conventions are in `CLAUDE.md`; the product specs are `hadarimdataspec.md` (data) and `budgetcontrolreportstandard.md` (report standard).

## 1. Two things live in this repository

1. **The v1 demo** (`index.html`, `src/` outside `src/hadarim/`): a browser-only, deterministic sixteen-scenario demo of the service idea. No database, no agent. Left as is; the README's first half describes it.
2. **The Hadarim prototype** (`src/hadarim/`, `supabase/`, `mcp/`, `.claude/`, `scripts/`): one real construction project (הדרים, 48.0M ₪ budget, 18 sections) in a shared database, a simulated contractor ERP people use in the browser, and a Claude Code agent ("בקרה") that is the budget controller. This document is about the prototype.

## 2. The prototype in one picture

```
 people in the company                         the budget controller
 ───────────────────────                       ─────────────────────────────────────
 hadarim.html  (React, "זיו — סביבת הדגמה")     claude --agent bakara   (Claude Code)
   invoices, orders, contracts, budget,           rules + skills (.claude/)
   change log, documents folder (upload)          │ MCP (stdio)
        │ writes (attributed) / reads              ▼
        ▼                                       mcp/bakara-server.ts → src/hadarim/tools/index.ts (52 tools)
 ┌────────────────────────────────────┐             │ loads the project, runs the pure engine, writes back
 │  Supabase project aevdlzncwkdosbzkgpgy │◄───────────┘
 │  Postgres tables (project_id keyed)  │
 │  triggers → change_log               │        src/hadarim/engine/  (pure, generic, tested)
 │  Storage bucket "documents"          │          checks · forecast · report · commands · operations · heartbeat
 │  Realtime                            │
 └────────────────────────────────────┘
        │ reads (Realtime)
        ▼
 report.html  (React, read-only): the agent's control session and report, live; saved versions; PDF / Word / Excel
```

Three principles hold everywhere:

- **Raw data comes from the database; everything else is calculated.** The engine derives findings, forecast, report and heartbeat work from the project's rows. Nothing in `engine/`, `tools/`, `features/` or the agent names a record, supplier, document, amount or person of the demo scenario; scenario specifics live only in the seed (`src/hadarim/data/`) and in tests.
- **Numbers are computed by code, never by the model or the UI.** The agent quotes tool results; the tools recompute from the live database on every call.
- **Writes are decisions.** Data changes only through attributed writes (`updated_by`), after a person decided, and the database triggers log them. The agent never applies a fix nobody approved; with no user present (a scheduled heartbeat) nothing is decided.

## 3. People and roles (the seed)

| Id | Name | Role | Writes allocations | Channel (future) |
| --- | --- | --- | --- | --- |
| EYAL | אייל | מנהל פרויקט | yes | WhatsApp |
| ROI | רועי | סמנכ״ל ביצוע | yes | WhatsApp |
| DANA | דנה | מנכ״לית | no | email |
| SARIT | שרית | הנהלת חשבונות | yes | email |

People are rows in `people` (per project). Every ERP screen has a "מבצע" selector, so each write is attributed to a person; the agent asks who is deciding when it matters and passes that person's id (`byId`, `approvedById`, `ownerId`). The channel is stored for the operational system; the prototype never sends anything.

## 4. The data (Supabase)

One Postgres project shared by local development and the hosted pages (URL and publishable key in `src/hadarim/db/config.ts`; the secret key is never committed). Every table is keyed by `project_id`; `HADARIM` is the seeded project and more projects are more rows.

| Group | Tables | Notes |
| --- | --- | --- |
| Reference | `projects`, `people`, `suppliers`, `sections`, `contracts`, `boq_lines`, `documents`, `budget_changes` | `projects` carries the policy: buildings and buckets for the per-building split, materiality thresholds, risk policy, check policy, physical progress and schedule, budget and BOQ versions, control dates. `sections` carry the original budget, kind (works / overhead / contingency) and the Blue Book chapters. |
| ERP | `invoices`, `purchase_orders`, `change_log` | Triggers on invoices, orders and budget changes write `change_log` (who, what, before, after, note) whenever a row inserted or edited carries `updated_by`. |
| Forecast | `forecast_versions`, `forecast_sections`, `forecast_lines` | Final versions of past controls and the draft of the current one. |
| Control session | `controls`, `decisions`, `forecast_adjustments`, `data_corrections`, `open_issues`, `questions`, `audit`, `report_versions`, `heartbeats` | Written only by the agent's tools. `open_issues` holds the responsibility table across controls. |
| Seed | schema `seed` (a copy of every reference, ERP and forecast table) | `snapshot_project_seed()` takes the snapshot after seeding; `reset_project()` restores it and clears the session tables, heartbeats and budget changes; the client also removes the project's uploaded files. |
| Files | Storage bucket `documents` | Object path `<project_id>/<document_id>/<file name>`; public read (prototype). |

Access is open through the publishable key: row-level security is on with one permissive policy per table, so restricting access later is a policy change, not a code change. Realtime is enabled on the ERP, session, documents, heartbeats and budget-changes tables; the pages re-read on every change.

Schema changes are migrations in `supabase/migrations/`, applied to the project and followed by `npm run db:types`; `npm run hadarim:seed` loads the generator package (`src/hadarim/data/generate.ts`, deterministic) and takes the seed snapshot; `npm run hadarim:reset` restores it.

## 5. The ERP mock (`hadarim.html`)

"זיו — סביבת הדגמה" imitates a contractor's ERP: dense screens, a module menu, a "מבצע" selector on every form. Hosted at `https://shaiber01.github.io/nadlan.ai/hadarim.html`.

| Screen | What a user can do | What is logged |
| --- | --- | --- |
| חשבונות ספקים | Open an invoice; change its budget section and building tag; key in a new invoice (supplier, document number, date, amount, description, section, contract, attachment); "copy the last invoice" | intake row on insert; section, building, amount, status, approval, description, document number, retention, cumulative and dates on edit |
| הזמנות רכש | Change an order's budget section (the invoices booked against it keep theirs; the screen warns when there are any); correct its quantity, quantity unit, price unit and unit price. A manual edit may leave the amount inconsistent with the line (the screen warns; the controller's own correction tool refuses). The card lists the order's documents with who read each and the facts read from it against the order's values, marked match / mismatch by the same comparison the checks use (`compareDocument`); invoice and contract cards show the same block | one row per change |
| חוזי קבלני משנה | Read: scope, inclusions, exclusions, retention, price appendices, documents | — |
| כתב כמויות | Read: the bill of quantities by Blue Book chapter — every line with its quantity, unit, budget section and contract coverage (the covering contract, or the exclusion clause that leaves it open), filters by chapter, section, coverage and text; click through to the covering contract or the line's document page. A line is addressable by URL (`?screen=boq&line=57.03.040`), which is how the report's coverage sources open it | — |
| תקציב ותחזית | Read: original budget, approved changes, updated budget, recorded, commitments, last approved forecast, Blue Book chapters per section. Key in an approved budget change (transfer / addition / reduction with approver, date, reason, reference) | a `budget` row per change |
| יומן שינויים | Read the trigger-written change log; click through to the record | — |
| תיקיית מסמכים | See every document with its processing status (including הוחלף for a replaced one); upload a real file (PDF, image, text) with kind, title, date, supplier, the record it belongs to, uploader. From a record's card (invoice, order, contract): download a document (a stored file, or a seed page as text), upload a file for that record, replace one of its documents — the replaced document stays in the folder marked, and the record, the checks and the agent's pending list use the new one (`documents.superseded_by`) — or delete one (file and row, after an inline confirmation naming who deletes; the change log gets a `document` entry, and a document it had replaced gets its place back) | — (the document row records the uploader) |

The presenter strip on top: database status, an "offline" switch (`?offline=1` or the `hadarim-offline` flag keeps the browser on the generator data, used by the e2e suites), the scene-1 variant (A: invoice 1147 exists and is re-allocated live; B: it is keyed in live) and a two-step "reset to seed". The store (`src/hadarim/app/store.ts`) loads the whole session from the database, persists only ERP rows through the attributed writers, and follows Realtime. A record can be addressed by URL (`hadarim.html?screen=invoices&invoice=1147`), which is how the report's source links open ERP records.

What the ERP never does: run a control, take a decision, process a document, change the forecast, or link to the report.

## 6. Documents

Two kinds of documents live in the folder (`documents` table):

- **Seed pages** — simulated invoices, quotes, price appendices, contract excerpts and BOQ pages rendered from structured blocks, with anchors the finding cards point at. Their facts were typed in with the seed (`facts_source.method = seed`).
- **Real files** — uploaded from the ERP's folder screen or handed to the agent in the session (`add_document`). The file goes to Storage; the row holds its path, type, the uploader, the record it belongs to, and later the extracted text and the facts.

A document with no `facts_source` that was not replaced by a newer upload (`superseded_by` null) is **unprocessed**. Processing is the agent's job, never the ERP's: `get_document` downloads the file to a local cache and returns its path — the agent reads a PDF or an image itself with `Read` (pdf.js text extraction is stored as a convenience; Hebrew PDFs often extract scrambled) — then `classify_document` (kind, title, date, supplier, linked record, one-line summary) and `set_document_facts` (the structured facts the checks use: amounts, quantities, unit prices, validity, BOQ line, retention, cumulative), which stamps the provenance (agent, who, when) and marks the document processed.

The facts are what the deterministic checks compare against: quotes and appendices drive the unit, price and coverage checks; an invoice's or order's own document drives the **document check** (kind `document`): every field the facts state must match the record, and since the document is the source, the card's proposed fix is the document's values (with retention, net payable and cumulative recomputed); a different supplier or quantity is referred instead.

## 7. The budget and the Blue Book chapters

The budget is the sections' **original** budget (`sections.budget`, the approved version on the project row) plus **approved budget changes** (`budget_changes`): transfers between sections, additions (an owner-approved increase, funding from outside the project), reductions — each with date, reason, reference and approver. They are keyed on the ERP's budget screen or recorded by the agent on the user's instruction (`add_budget_change`); a transfer or reduction may not take a section below zero; a change counts in a control when its date is on or before the control date. The working forecast gives every section `originalBudget`, `budgetChanges` and `budget` (updated); the report's sections table shows the three columns, the key table shows the original and the net change when changes exist, and variance and materiality use the updated budget. The budget is not the forecast: the forecast is changed with a stated basis (`add_forecast_adjustment`), never by editing the budget.

Sections carry the chapters of the Interministerial Specification for building works ("הספר הכחול", `src/hadarim/data/bluebook.ts` lists the chapter names) — the primary first — and BOQ lines carry their chapter. The tools roll the bill of quantities up by chapter (`query_boq`, `get_section`), and the report can add a view by chapter (`set_report_config` `byChapter`): each section counted once under its primary chapter, BOQ lines counted by their own chapter.

## 8. The agent ("בקרה")

The budget controller is a Claude Code agent defined in the repository: `.claude/agents/bakara.md` (role, rules, which tool for what), seven skills under `.claude/skills/bakara-*` (procedures), and the `bakara` MCP server in `.mcp.json` (the tools). A plain `claude` session in this folder is a development session and must not act as the controller.

Ways to run it:

```bash
claude --agent bakara                 # the whole session is the controller (approve the .mcp.json servers on first use)
# in a normal session: "use the bakara agent to run the control for הדרים"
npm run bakara -- tools               # the same registry from a shell; `tool <name> '{json}'` calls one
scripts/heartbeat.sh                  # the heartbeat headless (claude -p), for cron
```

Rules it keeps (the agent file has the exact wording): Hebrew only in what the user reads — no tool names, ids or English fragments, because terminals render mixed Hebrew and Latin text badly; facts from tools only, no arithmetic of its own; writes only after an explicit decision, attributed, verified by re-reading; budget and forecast are different things; say what kind of money a figure is (fact, commitment, estimate); the user decides; the report is produced by the tool, never written; confirm before destructive actions; when sure, recommend the fix and get approval; when unsure, ask the user and name the people connected to the record (never simulate asking others or talk about channels); no report without the checks; the checks are the floor and the agent's reading is the second pass; documents are the agent's to read; the heartbeat keeps up with the ERP.

### Tools (`src/hadarim/tools/index.ts`, 52)

| Group | Tools |
| --- | --- |
| Read | `list_projects`, `get_project`, `list_people`, `get_control`, `get_forecast`, `get_section`, `query_invoices`, `query_purchase_orders`, `list_contracts`, `get_contract`, `query_boq`, `list_suppliers`, `get_supplier`, `query_change_log`, `list_issues`, `search_documents`, `get_document`, `get_audit`, `list_report_versions`, `get_review_material`, `list_budget_changes`, `list_heartbeats` |
| Check (no writes) | `run_check` (a kind or all, for one record or a section), `get_heartbeat_work` |
| Control and decisions | `run_control`, `decide_finding`, `route_finding`, `confirm_quote`, `raise_finding`, `record_review_pass`, `finalize_control` |
| Attributed ERP writes | `reallocate_invoice`, `correct_purchase_order`, `set_invoice_building`, `create_invoice`, `add_budget_change` |
| Shaping the control and report | `add_forecast_adjustment`, `remove_forecast_adjustment`, `open_task`, `set_task_status`, `add_control_note`, `remove_control_note`, `set_project_status`, `set_report_config`, `build_report` |
| Documents | `add_document`, `classify_document`, `set_document_facts` |
| Heartbeat | `record_heartbeat` |
| Not given to the agent | `ask_person`, `answer_question` (questions to people over their channel — kept in the registry for the operational system) |
| Destructive | `reset_project` |

Every tool takes `projectId` (default HADARIM) and validates its input with zod; reads never write; writes go through the pure engine commands and are persisted by `db/session.ts`, with ERP rows written through the attributed writers so the triggers log them. The agent also has read-only SQL through the Supabase MCP for anything the tools do not return.

### Skills

| Skill | When |
| --- | --- |
| `/bakara-control` | Run the checks, walk the finding cards one at a time, apply decisions, then the review pass |
| `/bakara-report` | Build, enrich, restructure, export and finalize the report (runs the heartbeat first) |
| `/bakara-qa` | Questions about numbers, history, contracts, documents — tool first, SQL second, always with a source |
| `/bakara-erp` | Instructed data changes outside a card: re-allocate, correct an order, tag a building, key in an invoice, forecast changes with a basis, budget changes |
| `/bakara-extract` | Read a document (a real file or a seed page), describe it, record its facts |
| `/bakara-heartbeat` | Everything new since the last pass: pending documents, changed records, the checks on them |
| `/bakara-reset` | Reset a project to its seed (confirm first) |

### The control, step by step

1. `run_control` runs the deterministic checks on the live data as of the control date and opens the session. Check kinds: `allocation` (an invoice's section against its contract and the supplier's history; an order's section against its contract, the invoices billed against it, or the supplier's other records), `unit` (an order's quantity and units against the quote), `price` (a forecast remainder against the price appendix in force), `coverage` (BOQ lines with no contract, and the quotes that may price them), and the data-quality kinds `duplicate`, `contract_overrun`, `cumulative`, `retention`, `dates`, `review_aging`, `document`.
2. Each finding is a card with four blocks — הבעיה · המקורות · המשמעות · ההחלטה הנדרשת — plus the people connected to the record (who entered, approved, changed it) and, when the right values are determined by the data, a proposed fix. The agent shows the card, then asks for the decision with Claude Code's question tool (`AskUserQuestion`): clickable options, the recommended fix first, "Other" for free text. The same tool is used for a found quote, who is deciding, and confirmations (reset, save the configuration, finalize). Delegated as a subagent it cannot prompt: it returns the card and its options, the delegating session asks the user and continues the same agent with the answer (the relay protocol in `CLAUDE.md`).
3. The decision is applied through `decide_finding`, and the chosen option carries its own route: approving the fix updates the ERP there and then, while a "yes, but someone else keys it" option hands it over as a pending task — one question, never two. (`route_finding` remains for the route no card offers — correcting the forecast only — and for changing a route already taken.) Some decisions continue with `confirm_quote` (a quote found in the folder becomes an estimate and a task). Writes are permission-checked, attributed, logged by the triggers and verified by re-reading the row; the tool's verification line is quoted.
4. The review pass: `get_review_material` gathers what code cannot judge (contract scopes with the period's invoices, invoices without a contract, uncovered BOQ lines with candidate quotes, documents with text and facts); the agent reads and raises findings (`raise_finding`, kind `review`) that take the same card path — with a `proposedFix` when stored data names the fix (a section move for an invoice or an order, the invoice's fields as the document states them, the order's line under the amount lock; validated when raised, applied on approval through the same guarded, logged and verified commands as a check's fix, refused for an inferred value); `record_review_pass` closes it and the report states it.
5. When all findings are handled the session is in `report` state; `/bakara-report` takes over. `finalize_control` closes the control as the final version.

## 9. The heartbeat

The heartbeat is one pass over everything new since the previous one, so the report is short work and nothing entered in the ERP goes unchecked. It is a skill (`/bakara-heartbeat`) around two tools:

- `get_heartbeat_work` (deterministic): the pending documents (with their text and local path), the records inserted or changed in the ERP since the last heartbeat's watermark — the change log id, so every insert or edit made in the ERP or through the tools is in scope — grouped per record with who changed what and the contract the record is billed to, the checks' findings on those records or that neither the session nor an earlier heartbeat reported, and the control's undecided findings for context.
- The agent processes each pending document (read, classify, facts, re-check the linked record), reads each changed record against its contract, presents the findings with their recommended fix and the people involved, and with a user present gets the decisions through the control; with nobody present it presents them in the summary and leaves them open.
- `record_heartbeat` closes the pass with the watermark, the counts, the finding ids presented (repeated next time only if their record changes again) and a Hebrew summary: what was processed, what was found, what awaits the user.

Where it runs: `/bakara-report` runs it before building; `build_report` says in `attentionHe` when documents are pending or changes happened after the last heartbeat; `npm run bakara -- heartbeat` prints the deterministic work list; `scripts/heartbeat.sh` runs the agent headless for a cron or launchd job (not scheduled yet; it needs `claude` logged in or an API key on the machine — GitHub Actions `schedule` with a key is the hosted option). `list_heartbeats` shows the history and how many changes happened since the last one.

## 10. The report (`report.html`)

The report follows `budgetcontrolreportstandard.md`: 0 כותרת ומסגרת · 1 סיכום מנהלים · 2 תמונת מצב הפרויקט · 3 טבלת הסעיפים · 4 הסבר לשינויים (4א forecast changes, 4ב data corrections, never mixed) · 5 ניתוח סעיפים מהותיים · 6 בלתי צפוי, שינויים ותביעות · 7 סיכונים והזדמנויות · 8 נושאים לטיפול (and 8א open findings and questions) · 9 התאמות מאומתות · 10 השוואה לבקרה הקודמת ומגמות · 11 נספחים. `build_report` derives all of it from the session and the data on every call and runs the checks itself, so the report is never final while findings are undecided, documents are pending or the review pass was not done — and it says so. Saving a version and `finalize_control` are refused outright (`reportBlockers` in `engine/heartbeat.ts`) while a document is pending, no heartbeat was ever recorded, or the checks raise findings on records changed since the last heartbeat that nobody presented.

The page at `https://shaiber01.github.io/nadlan.ai/report.html` is a read-only, live view of the agent's session (rebuilt on every Realtime change) with the saved versions selectable next to the live one, exports (PDF through the browser's print, a real Word document, an Excel workbook with one sheet per table) and a status strip (not started / in work with counts / all findings handled / final). Nothing is edited there; source links open the ERP record in a new tab; the ERP never links here. The record modal shows the record's documents with the facts read from them against the record, the same block as the ERP card.

Structure options (`set_report_config`, kept for the project's next controls with `save`): comparison to the previous control and trends, the sections table per building (from the project's buildings and buckets), per Blue Book chapter, a one-page CEO version, the length of the executive summary. Content the data cannot know is recorded by the controller with `add_control_note` (risks, events, decisions needed, assumptions, change orders, claims), `set_project_status` (measured physical progress and schedule; also the project's materiality and risk policy), and the responsibility table (`open_task`, `set_task_status`).

## 11. The engine

`src/hadarim/engine/` is pure TypeScript over the project package (`pkg`, bound by `package.ts` to whatever project was loaded): `checks.ts` (the checks → findings, with people and proposed fixes), `forecast.ts` (the working forecast: recorded, committed, remaining commitment, uncovered by basis, EAC, variance per section; original budget + changes), `commands.ts` (state commands: ERP edits, control run, decisions, report config), `operations.ts` (adjustments, tasks, notes, questions, raised findings, instructed corrections), `report.ts` (the report model), `heartbeat.ts` (what is new since a watermark), `units.ts` (unit families and conversion), `model.ts` (session types). `db/session.ts` loads a `V2State` from the database and saves the diff back; the browser store and the tools use the same functions. Exports: `export/docx.ts`, `export/markdown.ts`, `export/xlsx.ts`.

Everything in the engine is tested offline on the generator package (`tests/hadarim.*.test.ts`: data, engine, tools, quality, review, generic, units, heartbeat, budget, documents, docx). Opt-in live tests hit the shared database and reset afterwards: `RUN_DB_TESTS=1 npm test` (round trip and the MCP stdio server), `RUN_DB_E2E=1 npx playwright test e2e/hadarim.db.spec.ts` (the whole loop: browser edit → control through the tools → viewer → saved version → reset).

## 12. Development

```bash
npm run dev                 # v1 at /, the ERP at /hadarim.html, the report at /report.html
npm test                    # vitest (offline); RUN_DB_TESTS=1 adds the live tests
npm run test:e2e            # Playwright against the production build (run npm run build first)
npm run build               # both entries into dist/
npm run bakara -- tools     # the tool registry; tool <name> '{...}' calls one; heartbeat prints the work list
npm run hadarim:seed        # load the generator package into Supabase and snapshot it as the seed
npm run hadarim:reset       # restore the seed
npm run db:types            # regenerate src/hadarim/db/types.ts after a migration
```

`.github/workflows/deploy.yml` runs the unit tests and the build on every push to `main` and publishes `dist/` to GitHub Pages. The repository is public: no secrets, no customer data. Conventions for changes are in `CLAUDE.md` (adding a tool: registry → the agent's tool list → the relevant skill; schema: migration → apply → advisors → types → re-seed when the seed changes).

## 13. Glossary

| Term | Meaning here |
| --- | --- |
| בקרה תקציבית / בקרה | The monthly budget control: checks, decisions, report. Also the agent's name. |
| סעיף | A budget section (18 in the seed, the company's own list), each with an original budget and Blue Book chapters. |
| תקציב מקורי / שינויים / תקציב מעודכן | Original budget, approved budget changes, updated budget. |
| נרשם | Recorded: approved (or paid) invoices received before the control's cutoff. |
| התחייבות / יתרת התחייבות | Commitment: signed contracts and approved orders; the part not yet invoiced. |
| יתרה לא מכוסה | Remainder to complete that no commitment covers, by basis (quote, appendix, estimate). |
| תחזית לגמר (EAC) | Recorded + remaining commitment + uncovered remainder, per section and total. |
| סטייה | Variance: forecast against the updated budget. |
| בסיס | The share of the forecast covered by commitments; below the policy threshold the forecast is "soft". |
| 4א / 4ב | Forecast changes (typed, with a basis) versus data corrections (no effect on the total). |
| ממצא | A finding: a check's or the agent's, always a card with a decision. |
| בלתי צפוי | Contingency: its own section, reported on its own row. |
| עכבון / מצטבר | Retention held on an invoice; cumulative amounts of a partial-invoice chain. |
| פעימת לב | The heartbeat: one pass over everything new since the previous one. |
| הספר הכחול | The Interministerial Specification chapters that construction budgets and BOQs are organised by. |
| מסמך לא מעובד | A document nobody read yet (no recorded facts); the agent processes it. |

## 14. Known limits and what comes next

- The heartbeat is not scheduled yet; `scripts/heartbeat.sh` plus a crontab line (or a GitHub Actions schedule with an API key) does it.
- Access is open through the publishable key (prototype); Supabase Auth and real row-level security policies are the next security step.
- Questions to people (`ask_person`) are recorded only; the operational system would send them over the person's channel. In the prototype the agent asks the user and names who to ask.
- Images are read by the agent only (no OCR); PDF text extraction is a convenience and Hebrew often comes out scrambled, which is why the agent reads the file itself.
- One project is seeded; more projects are more rows. Packaging `.claude/` and `mcp/` as a Claude Code plugin is planned.
