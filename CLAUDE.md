# nadlan.ai — developer guide

How the whole system works — the ERP mock, the database, documents, the budget, the agent, its tools and skills, the heartbeat, the report — is described in `docs/system-overview.md`; read it first. This file is the working conventions.

This repository is a budget-control prototype for construction projects (Hebrew, RTL). A regular Claude Code session here is a **development** session: you write and change code, migrations, tests and docs. The **budget controller is the `bakara` agent** (`.claude/agents/bakara.md`) with its skills (`.claude/skills/bakara-*`) and its tools (the `bakara` MCP server in `.mcp.json`). Delegate to it, or the user runs it, when the task is to *operate* the system — run a control, decide on findings, change the forecast, produce the report, answer questions about project data. Do not act as the controller from a development session.

## Running the agent

- Whole session as the controller: `claude --agent bakara` from this folder (the `.mcp.json` servers load; approve them on first use).
- From a normal session: "use the bakara agent to …" delegates one task to it. A subagent runs in the background and cannot pause for input, so when it reaches a decision (a finding card, a route, a confirmation) it returns the card and its options as its result. **Relay protocol for the development session:** show the card as returned, ask the user with `AskUserQuestion` (the same options, recommended fix first), then continue the *same* agent with `SendMessage` carrying the chosen option id — never start a new agent, and never decide on the user's behalf. For a whole control, `claude --agent bakara` is the better way: the cards are interactive there.
- `claude agents` lists the agents; the skills are `/bakara-control`, `/bakara-report`, `/bakara-qa`, `/bakara-erp`, `/bakara-reset`, `/bakara-extract` (read a document, record its facts), `/bakara-heartbeat` (everything new since the last pass: pending documents, changed records, the checks on them).
- Headless, for cron/launchd: `scripts/heartbeat.sh` runs `/bakara-heartbeat` with `claude -p` (nothing is decided without a user; the summary is what the user reads next).
- Two pages (`npm run dev`): `hadarim.html` is the simulated ERP, `report.html` the live, read-only view of the agent's report with the saved versions. Neither links to the other; the report's source links open ERP records in a new tab by URL (`hadarim.html?screen=invoices&invoice=1147`). Open the report next to the agent to watch the control take shape.
- The same tools from a shell: `npm run bakara -- tools`, `npm run bakara -- tool get_forecast '{"sectionId":"03"}'`.

## What is here

- `src/hadarim/` — the Hadarim product (entries `hadarim.html` → `App.tsx` for the ERP, `report.html` → `ReportApp.tsx` for the report):
  - `data/` — deterministic generator of the seed package (`generate.ts`), document pages (`documents.ts`), types, `bluebook.ts` (the chapters of the Interministerial Specification, reference data). Used for seeding and for offline/tests; the live data is in Supabase.
  - `engine/` — the deterministic core, general over any project's data: `checks.ts` (control checks → findings), `forecast.ts` (working forecast: recorded, committed, remaining, uncovered, EAC per section), `commands.ts` (pure state commands: ERP edits, control run, decisions on findings, report config), `operations.ts` (free-standing operations: forecast adjustments, tasks, controller notes, instructed corrections), `report.ts` (report model per `budgetcontrolreportstandard.md`, everything derived from data and notes), `units.ts` (unit families and conversion — a purchase-order line carries a unit for the quantity and one for the price, and is worth the quantity converted into the priced unit times the price), `model.ts` (session types). There is no scripted conversation: free text is the agent's job; the web app has buttons, cards and toggles only.
  - `tools/index.ts` — **the tool registry**: general-purpose read/check/decision/write tools over the database with zod schemas; the MCP server and the CLI both call it.
  - `documents/` — real files: `mime.ts` (browser-safe), `extract.ts` (Node: pdf.js text extraction; the agent reads PDFs/images itself with `Read` on the local path `get_document` returns). A document with no `facts_source` is unprocessed; only the agent processes (`classify_document`, `set_document_facts`).
  - `engine/heartbeat.ts` — what is new since the last heartbeat, measured on the change-log id (the watermark in `heartbeats`): changed records, the checks' findings on them, pending documents.
  - `db/` — Supabase: `config.ts` (URL + publishable key; the secret key is never committed), `client.ts` (rows ↔ engine types, attributed ERP writes, documents and Storage files, budget changes, heartbeats, realtime, project status), `session.ts` (control session load/save), `types.ts` (generated; `npm run db:types`).
  - `features/` — React screens: `erp/` (simulated ERP, including תיקיית מסמכים — upload to the Storage bucket `documents`), `report/` (living report, its own page `report.html`). `app/store.ts` bootstraps from the database (offline via `?offline=1`).
  - `export/` — Word (`docx.ts`), Markdown (`markdown.ts`) and Excel (`xlsx.ts`) renderers of the report model.
- `mcp/bakara-server.ts` — the registry as an MCP server over stdio (`npx vite-node mcp/bakara-server.ts`; stdout is protocol-only, log to stderr).
- `scripts/` — `bakara.ts` (CLI: demo commands, `heartbeat`, plus `tool <name> [json]` passthrough), `heartbeat.sh` (the agent's heartbeat headless), `seed-supabase.ts`, `reset-supabase.ts`, `dump-hadarim.ts`.
- `supabase/migrations/` — schema, triggers (change log), seed snapshot/reset functions, the Storage bucket `documents` and the `heartbeats` table, grants and permissive RLS policies (prototype: open access through the publishable key).
- `src/` (rest), `index.html` — the earlier v1 sixteen-scenario demo; leave it alone unless asked.
- Specs: `hadarimdataspec.md` (data, numbers win), `hadarimdemoscript.md` (demo flow and copy), `budgetcontrolreportstandard.md` (report standard). Status and decisions: `docs/hadarim-v2-plan.md`.

## Conventions

- Money in whole shekels (integers); quantities numeric; Hebrew product copy; English code and docs.
- Every table is keyed by `project_id`; `HADARIM` is the seeded project. Nothing in `engine/`, `tools/`, `features/` or the agent may hard-code a record, supplier, document, section id, person or amount of the demo scenario — derive it from the package (`pkg` in `engine/package.ts`: sections with `shortHe` and `kind`, `project.buildings` for any per-building logic, people by role, contracts, appendices, BOQ, forecast versions, documents' `facts`) and the live ERP state. Scenario specifics belong in `data/` (the seed) and in the tests. Policy settings live on the project row (`materiality` thresholds, `risk_policy` assumptions, `check_policy`, `buckets`, `buildings`; people carry a `channel`); the report standard's defaults are `STANDARD_MATERIALITY` and `STANDARD_RISK_POLICY` in `data/types.ts`.
- The budget is `sections.budget` (original) plus the approved `budget_changes` (transfer / addition / reduction, with an approver; keyed in the ERP's budget screen or `add_budget_change` on instruction; logged as record type `budget`). `workingForecast` gives every section `originalBudget`, `budgetChanges` and `budget` (updated); variance and materiality use the updated budget. Never "fix" a variance by changing the budget. Sections carry Blue Book `chapters` (primary first); BOQ lines carry their `chapter`; the report's `byChapter` view groups by them.
- A record is checked against its source document (`checkDocuments`, kind `document`): the facts recorded from the document (seed or the agent's reading) must match the record; the document is the source, so the proposed fix is the document's values.
- Numbers are computed in the engine, never in UI or agent prose. Keep the engine pure and tested (`tests/hadarim.engine.test.ts`, `tests/hadarim.tools.test.ts`).
- Adding a tool: define it in `src/hadarim/tools/index.ts` (name, description the agent reads, zod input, `kind`), add it to the agent's `tools:` list in `.claude/agents/bakara.md`, mention it in the relevant skill.
- ERP writes go through `db/client.ts` (`saveInvoice`, `savePurchaseOrder`) so `updated_by` is set and the database triggers write the change log; never write ERP rows with raw SQL from code.
- Schema changes: write a file in `supabase/migrations/` (timestamped name), apply with the Supabase MCP `apply_migration`, run `get_advisors`, then `npm run db:types`. Re-seed with `npm run hadarim:seed` when the seed package changes.
- The repository is public: no secrets, no customer data.

## Commands

```bash
npm run dev                 # v1 at /, Hadarim at /hadarim.html
npm test                    # vitest (RUN_DB_TESTS=1 adds the live round trip and the MCP stdio test)
npm run test:e2e            # Playwright (offline data; RUN_DB_E2E=1 adds the live browser test)
npm run build               # both entries; GitHub Pages deploys main
npm run bakara -- tools     # the tool registry; `tool <name> '{...}'` calls one
npm run bakara -- heartbeat # the deterministic heartbeat work list (the agent's /bakara-heartbeat does the reading)
npm run hadarim:seed        # load the generator package into Supabase and snapshot it as the seed
npm run hadarim:reset       # restore the seed
```

Commit on `main` at meaningful boundaries. The live database is shared: opt-in live tests mutate it, so reset afterwards.
