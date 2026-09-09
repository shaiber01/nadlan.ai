-- Materiality thresholds (report standard §5) are a project setting; the default is the standard's.
alter table public.projects add column if not exists materiality jsonb not null default '{"absolute":100000,"pct_of_section":3,"absolute_always":250000,"budget_share_pct":10,"soft_basis_pct":70}';
alter table seed.projects add column if not exists materiality jsonb not null default '{"absolute":100000,"pct_of_section":3,"absolute_always":250000,"budget_share_pct":10,"soft_basis_pct":70}';
