-- Sections carry their reporting kind so the engine never has to know a project's section ids:
-- contingency (reserve, reported on its own, excluded from the uncovered figure), overhead (internal
-- allocations), works (everything procured).
alter table public.sections add column if not exists kind text not null default 'works' check (kind in ('works', 'overhead', 'contingency'));
alter table seed.sections add column if not exists kind text not null default 'works';
