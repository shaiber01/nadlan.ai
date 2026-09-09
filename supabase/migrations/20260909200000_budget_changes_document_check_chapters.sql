-- Budget changes, the document consistency check and Blue Book chapters.
--
-- 1. The budget is the sections' original budget plus approved budget changes: transfers between sections,
--    additions and reductions, keyed in the ERP (attributed) or recorded by the agent on instruction. Each is
--    logged in the change log as record_type 'budget'. The report's "שינויים / תקציב מעודכן" columns come from here.
-- 2. Sections carry the chapters of the Interministerial Specification ("הספר הכחול") they cover; BOQ lines
--    already carry their chapter. (The document check needs no schema: it reads documents.facts.)

alter table public.change_log drop constraint if exists change_log_record_type_check;
alter table public.change_log add constraint change_log_record_type_check check (record_type in ('invoice', 'po', 'contract', 'budget'));

alter table public.sections add column if not exists chapters text[] not null default '{}';
alter table seed.sections add column if not exists chapters text[] not null default '{}';

create table if not exists public.budget_changes (
  project_id text not null references public.projects (id) on delete cascade,
  id text not null,
  date date not null,
  kind text not null check (kind in ('transfer', 'addition', 'reduction')),
  from_section_id text,
  to_section_id text,
  amount bigint not null check (amount > 0),
  reason_he text not null,
  reference_he text,
  approved_by text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, id),
  foreign key (project_id, from_section_id) references public.sections (project_id, id),
  foreign key (project_id, to_section_id) references public.sections (project_id, id),
  foreign key (project_id, approved_by) references public.people (project_id, id),
  check ((kind = 'transfer' and from_section_id is not null and to_section_id is not null and from_section_id <> to_section_id)
      or (kind = 'addition' and from_section_id is null and to_section_id is not null)
      or (kind = 'reduction' and from_section_id is not null and to_section_id is null))
);
create index if not exists budget_changes_project_date_idx on public.budget_changes (project_id, date);
alter table public.budget_changes enable row level security;
create policy "prototype open access" on public.budget_changes for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.budget_changes to anon, authenticated;
alter publication supabase_realtime add table public.budget_changes;

create table if not exists seed.budget_changes (like public.budget_changes including all);

-- Every budget change is a change-log row (record 'budget <id>'): who approved, what moved where.
create or replace function public.log_budget_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  label text;
begin
  if current_setting('app.skip_log', true) = '1' then
    return new;
  end if;
  label := case new.kind
    when 'transfer' then 'העברה ' || public.section_label(new.project_id, new.from_section_id) || ' → ' || public.section_label(new.project_id, new.to_section_id)
    when 'addition' then 'תוספת לסעיף ' || public.section_label(new.project_id, new.to_section_id)
    else 'הפחתה מסעיף ' || public.section_label(new.project_id, new.from_section_id)
  end;
  insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
  values (new.project_id, 'budget', new.id, 'שינוי תקציב', '—', label || ' · ' || public.fmt_num(new.amount) || ' ₪ · אישר ' || new.approved_by, new.created_by, new.reason_he);
  return new;
end;
$$;
drop trigger if exists budget_changes_log on public.budget_changes;
create trigger budget_changes_log after insert on public.budget_changes
for each row execute function public.log_budget_changes();

-- Seed snapshot and reset include budget changes.
create or replace function public.snapshot_project_seed(p_project_id text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from seed.change_log where project_id = p_project_id;
  delete from seed.open_issues where project_id = p_project_id;
  delete from seed.forecast_lines where project_id = p_project_id;
  delete from seed.forecast_sections where project_id = p_project_id;
  delete from seed.forecast_versions where project_id = p_project_id;
  delete from seed.boq_lines where project_id = p_project_id;
  delete from seed.invoices where project_id = p_project_id;
  delete from seed.purchase_orders where project_id = p_project_id;
  delete from seed.budget_changes where project_id = p_project_id;
  delete from seed.contracts where project_id = p_project_id;
  delete from seed.documents where project_id = p_project_id;
  delete from seed.sections where project_id = p_project_id;
  delete from seed.suppliers where project_id = p_project_id;
  delete from seed.people where project_id = p_project_id;
  delete from seed.projects where id = p_project_id;

  insert into seed.projects select * from public.projects where id = p_project_id;
  insert into seed.people select * from public.people where project_id = p_project_id;
  insert into seed.suppliers select * from public.suppliers where project_id = p_project_id;
  insert into seed.sections select * from public.sections where project_id = p_project_id;
  insert into seed.documents select * from public.documents where project_id = p_project_id;
  insert into seed.contracts select * from public.contracts where project_id = p_project_id;
  insert into seed.budget_changes select * from public.budget_changes where project_id = p_project_id;
  insert into seed.purchase_orders select * from public.purchase_orders where project_id = p_project_id;
  insert into seed.invoices select * from public.invoices where project_id = p_project_id;
  insert into seed.boq_lines select * from public.boq_lines where project_id = p_project_id;
  insert into seed.forecast_versions select * from public.forecast_versions where project_id = p_project_id;
  insert into seed.forecast_sections select * from public.forecast_sections where project_id = p_project_id;
  insert into seed.forecast_lines select * from public.forecast_lines where project_id = p_project_id;
  insert into seed.open_issues select * from public.open_issues where project_id = p_project_id;
  insert into seed.change_log (project_id, record_type, record_id, field, before, after, at, by_id, note_he)
    select project_id, record_type, record_id, field, before, after, at, by_id, note_he from public.change_log where project_id = p_project_id;
end;
$$;

create or replace function public.reset_project(p_project_id text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from seed.projects where id = p_project_id) then
    raise exception 'no seed snapshot for project %', p_project_id;
  end if;
  perform set_config('app.skip_log', '1', true);

  delete from public.heartbeats where project_id = p_project_id;
  delete from public.report_versions where project_id = p_project_id;
  delete from public.audit where project_id = p_project_id;
  delete from public.controls where project_id = p_project_id;   -- cascades to decisions, adjustments, corrections, questions
  delete from public.change_log where project_id = p_project_id;
  delete from public.open_issues where project_id = p_project_id;
  delete from public.forecast_versions where project_id = p_project_id;  -- cascades to sections and lines
  delete from public.invoices where project_id = p_project_id;
  delete from public.purchase_orders where project_id = p_project_id;
  delete from public.boq_lines where project_id = p_project_id;
  delete from public.budget_changes where project_id = p_project_id;
  delete from public.contracts where project_id = p_project_id;
  delete from public.documents where project_id = p_project_id;
  delete from public.sections where project_id = p_project_id;
  delete from public.suppliers where project_id = p_project_id;
  delete from public.people where project_id = p_project_id;
  delete from public.projects where id = p_project_id;

  insert into public.projects select * from seed.projects where id = p_project_id;
  insert into public.people select * from seed.people where project_id = p_project_id;
  insert into public.suppliers select * from seed.suppliers where project_id = p_project_id;
  insert into public.sections select * from seed.sections where project_id = p_project_id;
  insert into public.documents select * from seed.documents where project_id = p_project_id;
  insert into public.contracts select * from seed.contracts where project_id = p_project_id;
  insert into public.budget_changes select * from seed.budget_changes where project_id = p_project_id;
  insert into public.purchase_orders select * from seed.purchase_orders where project_id = p_project_id;
  insert into public.invoices select * from seed.invoices where project_id = p_project_id;
  insert into public.boq_lines select * from seed.boq_lines where project_id = p_project_id;
  insert into public.forecast_versions select * from seed.forecast_versions where project_id = p_project_id;
  insert into public.forecast_sections select * from seed.forecast_sections where project_id = p_project_id;
  insert into public.forecast_lines select * from seed.forecast_lines where project_id = p_project_id;
  insert into public.open_issues select * from seed.open_issues where project_id = p_project_id;
  insert into public.change_log (project_id, record_type, record_id, field, before, after, at, by_id, note_he)
    select project_id, record_type, record_id, field, before, after, at, by_id, note_he from seed.change_log where project_id = p_project_id;
end;
$$;
