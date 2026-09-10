-- Saved report versions are part of the seed. Until now a reset deleted every saved version; the snapshot now
-- keeps the project's versions and a reset restores them (versions saved since the snapshot go). Like
-- seed.change_log the seed copy has its own identity id; author, timestamps and the report model are kept.
create table if not exists seed.report_versions (like public.report_versions including all);
grant select, insert, delete on seed.report_versions to anon, authenticated;
grant usage, select on all sequences in schema seed to anon, authenticated;
alter table seed.report_versions enable row level security;
drop policy if exists "prototype open access" on seed.report_versions;
create policy "prototype open access" on seed.report_versions for all to anon, authenticated using (true) with check (true);

create or replace function public.snapshot_project_seed(p_project_id text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from seed.report_versions where project_id = p_project_id;
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
  insert into seed.report_versions (project_id, control_date, label, created_at, created_by, model, docx_path)
    select project_id, control_date, label, created_at, created_by, model, docx_path from public.report_versions where project_id = p_project_id order by id;
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
  -- the saved report versions that ship with the seed come back with their author and dates
  insert into public.report_versions (project_id, control_date, label, created_at, created_by, model, docx_path)
    select project_id, control_date, label, created_at, created_by, model, docx_path from seed.report_versions where project_id = p_project_id order by id;
end;
$$;
