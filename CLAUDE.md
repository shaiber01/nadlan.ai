# nadlan.ai — developer guide

This repository is a budget-control prototype for construction projects (Hebrew, RTL). A regular Claude Code session here is a **development** session: you write and change code, migrations, tests and docs. The **budget-controller persona lives in the `bakara` agent** (`.claude/agents/bakara.md`) with its skills (`.claude/skills/bakara-*`); delegate to it, or the user invokes it, when the task is to *operate* the system — run a control, decide on findings, produce the report, answer questions about project data. Do not act as the controller from a development session.

## What is here

- `src/hadarim/` — the Hadarim product (entry `hadarim.html`):
  - `data/` — deterministic generator of the seed package (`generate.ts`), document pages (`documents.ts`), types. Used for seeding and for offline/tests; the live data is in Supabase.
  - `engine/` — the deterministic core: `checks.ts` (control checks → findings), `forecast.ts` (working forecast: recorded, committed, remaining, uncovered, EAC per section), `commands.ts` (pure state commands used by the browser chat), `report.ts` (report model per `budgetcontrolreportstandard.md`), `conversation.ts` (scripted browser-chat intents), `model.ts` (session types).
  - `db/` — Supabase: `config.ts` (URL + publishable key; the secret key is never committed), `client.ts` (rows ↔ engine types, ERP writes, realtime), `session.ts` (control session load/save), `types.ts` (generated; `npm run db:types`).
  - `features/` — React screens: `erp/` (simulated ERP), `control/` (browser chat + board), `report/` (living report). `app/store.ts` bootstraps from the database (offline via `?offline=1`).
  - `export/` — Word (`docx.ts`) and Markdown (`markdown.ts`) renderers of the report model.
- `scripts/` — `bakara.ts` (the engine as a CLI over the database; the agent's current tool surface), `seed-supabase.ts`, `reset-supabase.ts`, `dump-hadarim.ts`.
- `supabase/migrations/` — schema, triggers (change log), seed snapshot/reset functions, grants and permissive RLS policies (prototype: open access through the publishable key).
- `src/` (rest), `index.html` — the earlier v1 sixteen-scenario demo; leave it alone unless asked.
- Specs: `hadarimdataspec.md` (data, numbers win), `hadarimdemoscript.md` (demo flow and copy), `budgetcontrolreportstandard.md` (report standard). Status and decisions: `docs/hadarim-v2-plan.md`.

## Conventions

- Money in whole shekels (integers); quantities numeric; Hebrew product copy; English code and docs.
- Every table is keyed by `project_id`; `HADARIM` is the seeded project.
- Numbers are computed in the engine, never in UI or agent prose. Keep the engine pure and tested.
- ERP writes go through `db/client.ts` (`saveInvoice`, `savePurchaseOrder`) so `updated_by` is set and the database triggers write the change log; never write ERP rows with raw SQL from code.
- Schema changes: write a file in `supabase/migrations/` (timestamped name), apply with the Supabase MCP `apply_migration`, run `get_advisors`, then `npm run db:types`. Re-seed with `npm run hadarim:seed` when the seed package changes.
- The repository is public: no secrets, no customer data.

## Commands

```bash
npm run dev                 # v1 at /, Hadarim at /hadarim.html
npm test                    # vitest (RUN_DB_TESTS=1 adds the live round trip)
npm run test:e2e            # Playwright (offline data; RUN_DB_E2E=1 adds the live browser test)
npm run build               # both entries; GitHub Pages deploys main
npm run bakara -- status    # the CLI tools (see scripts/bakara.ts header for all commands)
npm run hadarim:seed        # load the generator package into Supabase and snapshot it as the seed
npm run hadarim:reset       # restore the seed
```

Commit on `main` at meaningful boundaries. The live database is shared: opt-in live tests mutate it, so reset afterwards.
