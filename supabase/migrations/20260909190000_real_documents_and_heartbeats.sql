-- Real documents in the project folder and the heartbeat.
--
-- Documents can now be real files (Storage bucket `documents`, object path <project_id>/<document_id>/<file name>)
-- next to the seed's simulated pages. `facts_source is null` means the document has not been processed yet:
-- processing is the agent reading the file and recording its facts (set_document_facts) — the ERP users only
-- upload. A heartbeat is the agent's pass over everything new since the previous one: pending documents and the
-- change-log rows above the last watermark (`change_log.id`), checked for errors; `heartbeats` records each pass.

alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('invoice', 'quote', 'appendix', 'contract_excerpt', 'boq_page', 'delivery_note', 'letter', 'other'));

alter table public.documents
  add column if not exists file_path text,
  add column if not exists mime_type text,
  add column if not exists size_bytes integer,
  add column if not exists text text,
  add column if not exists uploaded_by text,
  add column if not exists uploaded_at timestamptz,
  add column if not exists record_type text check (record_type is null or record_type in ('invoice', 'po', 'contract')),
  add column if not exists record_id text,
  add column if not exists summary_he text;
alter table seed.documents
  add column if not exists file_path text,
  add column if not exists mime_type text,
  add column if not exists size_bytes integer,
  add column if not exists text text,
  add column if not exists uploaded_by text,
  add column if not exists uploaded_at timestamptz,
  add column if not exists record_type text,
  add column if not exists record_id text,
  add column if not exists summary_he text;
create index if not exists documents_record_idx on public.documents (project_id, record_type, record_id);

-- The bucket. Public read so the web viewer can show the file; open write for the prototype (same policy as the tables).
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', true, 20971520)
on conflict (id) do nothing;
drop policy if exists "prototype open access documents" on storage.objects;
create policy "prototype open access documents" on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'documents') with check (bucket_id = 'documents');

create table if not exists public.heartbeats (
  project_id text not null references public.projects (id) on delete cascade,
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by_id text not null,
  since_change_log_id bigint not null default 0,
  until_change_log_id bigint not null default 0,
  documents_pending integer not null default 0,
  documents_processed integer not null default 0,
  records_changed integer not null default 0,
  findings integer not null default 0,
  summary_he text not null default '',
  details jsonb not null default '{}'
);
create index if not exists heartbeats_project_idx on public.heartbeats (project_id, id desc);
alter table public.heartbeats enable row level security;
create policy "prototype open access" on public.heartbeats for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.heartbeats to anon, authenticated;
alter publication supabase_realtime add table public.heartbeats, public.documents;

-- Reset also forgets the heartbeats (the uploaded documents go with the documents table; the client removes their files).
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
