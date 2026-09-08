---
name: bakara-erp
description: Write to the simulated ERP (Supabase) on the user's instruction — re-allocate an invoice, correct a purchase order, tag a building, key in a new invoice — with attribution and the trigger-written change log. Use for scene 1 without the browser and for any correction the user approves.
---

# ERP writes — only on the user's decision

Every write is attributed (`--by <person id>`: EYAL, ROI, DANA, SARIT) and logged by the database triggers. Before writing, restate what will change and who decides; after writing, quote the change-log rows the tool prints.

```bash
# re-allocate an invoice to another budget section (the scene-1 change: 1147 from 07 to 02 by שרית)
npm run bakara -- erp set-section 1147 02 --by SARIT --note "תיקון שיוך"

# correct a purchase order; qty × unit price must still equal the order amount
npm run bakara -- erp set-po 2291 --qty 12 --unit טון --price 4800 --by EYAL

# tag an invoice with a building for the per-building split
npm run bakara -- erp set-building 1147 A --by EYAL

# key in a new invoice (variant B of scene 1: after `reset --variant B`, the number 1147 is assigned)
npm run bakara -- erp new-invoice --supplier SUP-NTB --docno 2026-087 --date 2026-08-31 --amount 180000 \
  --desc "עבודות עפר וקווי ניקוז — פיתוח חוץ, שלב א׳" --section 02 --contract 07-01 --attachment inv_1147_ntb_partial7 --by SARIT
```

Rules:
- Permission: only people with `can_write_allocation` may re-allocate (the tool refuses otherwise and says who is not allowed). Do not work around it.
- A correction that came out of a control finding goes through `route <finding> update` (in `/bakara-control`), not through `erp …`, so the decision, correction and verification are recorded together.
- Never write with SQL. Never delete records.
- Section ids are two digits ("01"–"18"); building tags are `A`, `B`, `משותף`.
- After a write, `npm run bakara -- status` shows "שינויים היום במערכת המידע"; a control run afterwards will see the change ("ברשומה ששונתה היום").
