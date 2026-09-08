---
name: bakara-reset
description: Reset project הדרים to its seed data before a rehearsal or demo, or re-run the control from scratch. Destructive for the shared database — always confirm with the user first.
---

# Reset to seed

The database is shared by the web app (local and hosted) and this agent. Reset restores the ERP data and change log to the seed snapshot and clears the control session, audit and saved report versions for the project.

```bash
npm run bakara -- reset               # variant A: invoice 1147 exists on 07-פיתוח, ready to be re-allocated live
npm run bakara -- reset --variant B   # variant B: invoice 1147 is removed so it can be keyed in live
npm run bakara -- status              # confirm: 216 invoices (215 in variant B), control idle, forecast 48,000,000 ₪
```

Rules:
- Ask before resetting ("לאפס את נתוני הדרים? זה מוחק את הבקרה הנוכחית ואת ההיסטוריה של היום").
- To redo only the control while keeping today's ERP edits: `npm run bakara -- control run --force` (also confirm first).
- The web app follows the reset automatically (Realtime); a browser that was offline (`?offline=1`) keeps its own local copy and is not affected.
- If the seed snapshot itself must be rebuilt (schema change, new data package): `npm run hadarim:seed` from a shell with network access — this replaces the project's data and takes a new snapshot.
