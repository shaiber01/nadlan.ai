-- The seed copy of budget_changes was created after the schema-wide grants: grant it like the other seed tables
-- (the snapshot and reset functions run with the caller's rights).
grant select, insert, delete on seed.budget_changes to anon, authenticated;
