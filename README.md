# בקרה — budget control for construction projects

A budget-control prototype for construction projects (Hebrew, RTL): a shared Supabase database, a simulated contractor ERP in the browser, a Claude Code agent ("בקרה") that is the budget controller through a general-purpose tool server, real documents the agent reads, a heartbeat over everything new, and the control report on its own page. **How it all works: [`docs/system-overview.md`](docs/system-overview.md).** Developer conventions are in `CLAUDE.md`; this file is the short version.

Everything is synthetic. There is no real ERP, no customer data and no real message delivery; the badge **סביבת הדגמה · נתונים סינתטיים** says so inside the app.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173/hadarim.html (the root redirects there); the report at /report.html
npm test           # vitest: data, engine, tools, report, documents, heartbeat, budget
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm run test:e2e   # Playwright against the production build (run npm run build first)
```

Node 22 and npm are the only requirements. The build uses a relative base path, so `dist/` runs from GitHub Pages, any sub-folder, or a plain file server. `.github/workflows/deploy.yml` publishes `main` to GitHub Pages: the ERP at `https://shaiber01.github.io/nadlan.ai/hadarim.html`, the report at `https://shaiber01.github.io/nadlan.ai/report.html`.

## The prototype

One project (הדרים, 48.0M budget, 18 sections) in a shared database, and two pages — the simulated contractor ERP ("זיו — סביבת הדגמה", `hadarim.html`) whose edits are written to the database, and **the control report** (`report.html`) — a live, read-only view of the control the Claude agent ("בקרה") runs and of the report it produces per `budgetcontrolreportstandard.md`, with the saved versions and PDF / Word / Excel exports. The ERP never links to the report; the report's source links open ERP records in a new tab. There is one budget controller, the agent; the web app does not run controls or take decisions. Specs: `hadarimdataspec.md`; reconciliation and status: `docs/hadarim-v2-plan.md`.

Running it: `npm run dev` for the two pages, `claude --agent bakara` for the controller. The agent runs the checks on the live data, brings each finding as a card, writes the ERP only on a decision, and builds the report per `budgetcontrolreportstandard.md`; **דוח הבקרה** in the browser follows it live. Errors for a check to act on are not seeded — `tests/fixtures/scenario.ts` holds the ones the tests use, and no script stages them in the live database.

The presenter strip switches screens, picks whether the ERP starts with invoice 1147 or without it (variant A/B), toggles offline work and resets to the seed (two-step; online it restores the database snapshot). Offline (`?offline=1`) the browser uses the generator data only. Everything is derived from `src/hadarim/data/generate.ts` (deterministic; `npm run hadarim:dump` writes CSV/JSON to `data/hadarim/`); checks in `src/hadarim/engine/checks.ts`; commands, operations, working forecast and report model in `src/hadarim/engine/`; screens in `src/hadarim/features/`. Tests: `tests/hadarim.*.test.ts` (data, engine, tools, quality, review, generic, units, heartbeat, budget, documents, docx, cards), `e2e/hadarim*.spec.ts` (ERP and the viewer offline) and `e2e/hadarim.db.spec.ts` (`RUN_DB_E2E=1`: the whole loop on the live database — browser edit, control through the tools, viewer, saved version, reset — with element screenshots in `e2e/screenshots/hadarim-v-*.png`).

### Database (prototype)

The data lives in a Supabase Postgres project shared by local and hosted runs (`src/hadarim/db/config.ts` holds the URL and the publishable key; the secret key is never committed). Schema and triggers are in `supabase/migrations/`; the change log is written by database triggers whenever an invoice, a purchase order or a budget change is written with an actor; uploaded documents live in the Storage bucket `documents`.

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

The tools (`src/hadarim/tools/index.ts`, served by `mcp/bakara-server.ts`; listed by group in the overview) are general-purpose over any project in the database — reads (`get_project`, `get_forecast`, `get_section`, `query_invoices`, `query_change_log`, `search_documents`, …), checks (`run_check`, `get_heartbeat_work`, `report_readiness`), the control and its decisions (`run_control`, `decide_finding`, `route_finding`, `confirm_quote`, `raise_finding`, `record_review_pass`), attributed writes (`reallocate_invoice`, `correct_purchase_order`, `create_invoice`, `add_budget_change`, `add_forecast_adjustment`, `open_task`, `add_control_note`, `set_project_status`), documents (`add_document`, `classify_document`, `set_document_facts`), the heartbeat (`record_heartbeat`) and the report (`set_report_config`, `build_report`, `finalize_control`). The agent never computes numbers itself; every figure it quotes comes from a tool result, every write is attributed to the person who decided, logged by the database triggers and re-read as verification. The same registry is available from a shell:

```bash
npm run bakara -- tools                                     # list the tools
npm run bakara -- tool get_forecast '{"sectionId":"03"}'    # call one
npm run bakara -- heartbeat                                 # the deterministic heartbeat work list
```

## Where to change things

| What | Where |
| --- | --- |
| The seed: project, sections, people, contracts, orders, invoices, forecast versions, document pages | `src/hadarim/data/generate.ts`, `documents.ts`, `bluebook.ts`, `types.ts` (policy defaults) |
| Checks and finding cards | `src/hadarim/engine/checks.ts` |
| Working forecast (recorded, committed, remaining, uncovered, EAC, budget changes) | `src/hadarim/engine/forecast.ts` |
| State commands, free-standing operations, the heartbeat | `src/hadarim/engine/commands.ts`, `operations.ts`, `heartbeat.ts` |
| The report model (per `budgetcontrolreportstandard.md`) and its exports | `src/hadarim/engine/report.ts`; `src/hadarim/export/docx.ts`, `markdown.ts`, `xlsx.ts` |
| The tools the agent and the CLI call | `src/hadarim/tools/index.ts`; served by `mcp/bakara-server.ts` |
| The agent, its rules and skills | `.claude/agents/bakara.md`, `.claude/skills/bakara-*/SKILL.md` |
| Database access, attributed writes, documents, realtime | `src/hadarim/db/client.ts`, `session.ts`; schema in `supabase/migrations/` |
| Screens | `src/hadarim/features/erp/` (the ERP), `features/report/` (the report page); shared primitives in `src/hadarim/components/`, styles in `src/hadarim/styles/` |

## Limitations

- A prototype: access to the database is open through the publishable key, Storage is public-read, and there is one seeded project.
- The agent reads documents itself; there is no OCR service. Questions to people (`ask_person`) are recorded, not sent — a real channel belongs to the operational system.
- Amounts are whole shekels before VAT; retention, financing, foreign currency and a time-phased earned-value model are out of scope.
