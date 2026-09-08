---
name: bakara-reset
description: Reset a project to its seed data before a rehearsal or demo, or re-run its control from scratch. Destructive for the shared database — always confirm with the user first.
---

# Reset to seed

The database is shared by the web app (local and hosted) and this agent. `reset_project` restores the project's ERP data and change log to the seed snapshot and clears the control session, audit and saved report versions.

1. Ask: "לאפס את נתוני <project>? זה מוחק את הבקרה הנוכחית, את ההיסטוריה של היום ואת גרסאות הדוח השמורות." Wait for a yes.
2. `reset_project` with `variant`: `A` (default — the seed as is, ready for the demo's live re-allocation) or `B` (the seed's last invoice removed so it can be keyed in live with `create_invoice`).
3. Confirm from the result: `invoices`, `controlStatus: idle`, `headline` (for הדרים: 216 invoices in A, 215 in B, forecast 48,000,000 ₪).

To redo only the control while keeping today's data edits: `run_control` with `force: true` (also confirm first — it discards the control's decisions).

The web app follows a reset automatically (Realtime); a browser opened with `?offline=1` keeps its own local copy and is not affected. Rebuilding the seed snapshot itself (schema or data package change) is a development task: `npm run hadarim:seed` in a normal session.
