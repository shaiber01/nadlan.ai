-- Agent-authored control notes (risks, events, decisions needed, assumptions) and project status fields,
-- so the report no longer hard-codes them. (Control tables have no seed copy; only projects is mirrored.)
alter table public.controls add column if not exists notes jsonb not null default '[]';
alter table public.projects add column if not exists physical_progress_pct numeric;
alter table public.projects add column if not exists schedule jsonb not null default '{}';   -- {contract_end, expected_end, note_he}

alter table seed.projects add column if not exists physical_progress_pct numeric;
alter table seed.projects add column if not exists schedule jsonb not null default '{}';
