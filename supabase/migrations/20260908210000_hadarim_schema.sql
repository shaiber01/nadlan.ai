-- Hadarim budget-control prototype: ERP data, forecasts, control sessions, audit, seed copy.
-- Every table is keyed by project_id so more projects can be added as rows later.
-- Money is stored in whole shekels (bigint), quantities as numeric.
--
-- Access model (prototype decision, 2026-09-08): open access through the publishable key.
-- RLS is enabled everywhere with a single permissive policy per table so tightening later is a
-- policy change, not a schema change.

create schema if not exists seed;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table public.projects (
  id text primary key,
  name_he text not null,
  company_he text not null,
  units integer,
  gross_sqm integer,
  start_date date,
  status_he text,
  budget_version jsonb not null,          -- {number, approved_at, amount}
  boq_version jsonb not null,             -- {number, date}
  control_dates date[] not null default '{}',
  current_control_date date,
  buildings jsonb not null default '[]',  -- [{id, floors, floors_cast, units_per_floor}]
  created_at timestamptz not null default now()
);

create table public.people (
  project_id text not null references public.projects (id) on delete cascade,
  id text not null,
  name_he text not null,
  role_he text not null,
  can_write_allocation boolean not null default false,
  primary key (project_id, id)
);

create table public.suppliers (
  project_id text not null references public.projects (id) on delete cascade,
  id text not null,
  name_he text not null,
  kind text not null check (kind in ('subcontractor', 'supplier', 'service', 'consultant')),
  primary key (project_id, id)
);

create table public.sections (
  project_id text not null references public.projects (id) on delete cascade,
  id text not null,
  name_he text not null,
  short_name_he text not null,
  budget bigint not null check (budget >= 0),
  split text not null check (split in ('by_floors', 'by_units', 'shared', 'parking', 'per_building')),
  position integer not null,
  primary key (project_id, id)
);

create table public.documents (
  project_id text not null references public.projects (id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('invoice', 'quote', 'appendix', 'contract_excerpt', 'boq_page')),
  title_he text not null,
  date date not null,
  supplier_id text,
  file_name text not null,
  blocks jsonb not null default '[]',
  footer_he text not null default '',
  anchors jsonb not null default '{}',
  facts jsonb not null default '{}',
  primary key (project_id, id),
  foreign key (project_id, supplier_id) references public.suppliers (project_id, id)
);

create table public.contracts (
  project_id text not null references public.projects (id) on delete cascade,
  id text not null,
  section_id text not null,
  supplier_id text not null,
  amount bigint check (amount is null or amount >= 0),   -- null = framework agreement without a fixed amount
  signed_at date not null,
  scope_he text not null default '',
  inclusions_he text[] not null default '{}',
  exclusions jsonb not null default '[]',                -- [{clause, text_he, covered_by_contract_id}]
  retention_pct numeric(5, 2) not null default 0,
  closed jsonb,                                          -- {at, final_account}
  steel_supplied_by_client boolean not null default false,
  price_appendices jsonb,                                -- [{id, price_per_ton, valid_from, document_id}]
  document_id text,
  note_he text,
  boq_match_verified boolean not null default false,
  primary key (project_id, id),
  foreign key (project_id, section_id) references public.sections (project_id, id),
  foreign key (project_id, supplier_id) references public.suppliers (project_id, id),
  foreign key (project_id, document_id) references public.documents (project_id, id)
);

-- ---------------------------------------------------------------------------
-- ERP records the presenter (and the agent) edit
-- ---------------------------------------------------------------------------

create table public.purchase_orders (
  project_id text not null references public.projects (id) on delete cascade,
  id integer not null,
  date date not null,
  supplier_id text not null,
  section_id text not null,
  contract_id text,
  description_he text not null,
  qty numeric not null check (qty > 0),
  unit text not null,
  unit_price numeric not null check (unit_price >= 0),
  amount bigint not null check (amount >= 0),
  delivered_qty numeric not null default 0,
  invoiced_amount bigint not null default 0,
  status text not null check (status in ('פתוחה', 'סגורה')),
  attachment_id text,
  kind text not null check (kind in ('blanket', 'one_off')),
  updated_by text,                                       -- person id of the last editor (drives the change log)
  update_note_he text,
  updated_at timestamptz not null default now(),
  primary key (project_id, id),
  foreign key (project_id, supplier_id) references public.suppliers (project_id, id),
  foreign key (project_id, section_id) references public.sections (project_id, id),
  foreign key (project_id, contract_id) references public.contracts (project_id, id),
  foreign key (project_id, attachment_id) references public.documents (project_id, id)
);

create table public.invoices (
  project_id text not null references public.projects (id) on delete cascade,
  id integer not null,
  supplier_id text not null,
  supplier_doc_no text not null,
  doc_type text not null check (doc_type in ('חשבון חלקי', 'חשבונית מס', 'חשבון סופי', 'חשבון מקדמה')),
  partial_no integer,
  period text not null,                                  -- yyyy-mm
  date date not null,
  date_received date not null,
  entered_at date not null,
  entered_by text not null,
  section_id text not null,
  contract_id text,
  po_id integer,
  description_he text not null,
  amount bigint not null check (amount > 0),
  cumulative_prev bigint,
  cumulative_now bigint,
  retention_pct numeric(5, 2) not null default 0,
  retention_amt bigint not null default 0,
  net_payable bigint not null,
  building text check (building is null or building in ('A', 'B', 'משותף')),
  status text not null check (status in ('אושר', 'בבדיקה', 'שולם')),
  approved_by text,
  attachment_id text,
  quantity numeric,
  unit text,
  unit_price numeric,
  updated_by text,
  update_note_he text,
  updated_at timestamptz not null default now(),
  primary key (project_id, id),
  foreign key (project_id, supplier_id) references public.suppliers (project_id, id),
  foreign key (project_id, section_id) references public.sections (project_id, id),
  foreign key (project_id, contract_id) references public.contracts (project_id, id),
  foreign key (project_id, po_id) references public.purchase_orders (project_id, id),
  foreign key (project_id, attachment_id) references public.documents (project_id, id)
);
create index invoices_section_idx on public.invoices (project_id, section_id, date_received);
create index invoices_contract_idx on public.invoices (project_id, contract_id);
create index invoices_supplier_idx on public.invoices (project_id, supplier_id);

create table public.boq_lines (
  project_id text not null references public.projects (id) on delete cascade,
  id text not null,
  chapter text not null,
  chapter_name_he text not null,
  description_he text not null,
  qty numeric not null,
  unit text not null,
  section_id text not null,
  coverage text not null check (coverage in ('covered', 'excluded', 'not_contracted')),
  coverage_ref text,
  covered_by_contract_id text,
  note_he text,
  position integer not null,
  primary key (project_id, id),
  foreign key (project_id, section_id) references public.sections (project_id, id),
  foreign key (project_id, covered_by_contract_id) references public.contracts (project_id, id)
);

-- ---------------------------------------------------------------------------
-- Forecast versions (one per control date; final or draft)
-- ---------------------------------------------------------------------------

create table public.forecast_versions (
  project_id text not null references public.projects (id) on delete cascade,
  control_date date not null,
  status text not null check (status in ('final', 'draft')),
  total_eac bigint not null,
  has_sections boolean not null default true,            -- false for the totals-only early controls
  qualifications_he text[] not null default '{}',
  primary key (project_id, control_date)
);

create table public.forecast_sections (
  project_id text not null,
  control_date date not null,
  section_id text not null,
  budget bigint not null,
  recorded bigint not null,
  committed bigint not null,
  remaining_commitment bigint not null,
  uncovered bigint not null,
  eac bigint not null,
  coverage_note_he text,
  primary key (project_id, control_date, section_id),
  foreign key (project_id, control_date) references public.forecast_versions (project_id, control_date) on delete cascade,
  foreign key (project_id, section_id) references public.sections (project_id, id)
);

create table public.forecast_lines (
  project_id text not null,
  control_date date not null,
  id text not null,
  section_id text not null,
  description_he text not null,
  qty numeric,
  unit text,
  unit_price numeric,
  amount bigint not null,
  basis text not null check (basis in ('invoice', 'contract', 'po', 'quote', 'appendix', 'estimate', 'allocation')),
  source_ref text,
  kind text not null check (kind in ('remaining_commitment', 'uncovered')),
  position integer not null,
  primary key (project_id, control_date, id),
  foreign key (project_id, control_date, section_id) references public.forecast_sections (project_id, control_date, section_id) on delete cascade
);

create table public.open_issues (
  project_id text not null references public.projects (id) on delete cascade,
  id text not null,
  title_he text not null,
  section_id text,
  owner_id text not null,
  due_date date,
  opened_in_control date not null,
  status text not null check (status in ('open', 'closed', 'pending_execution')),
  closed_at date,
  impact_if_ignored_he text,
  finding_id text,                                       -- set when the issue was opened by a control finding
  primary key (project_id, id),
  foreign key (project_id, section_id) references public.sections (project_id, id),
  foreign key (project_id, owner_id) references public.people (project_id, id)
);

-- ---------------------------------------------------------------------------
-- Change log: written by triggers on the ERP tables (any writer, any path)
-- ---------------------------------------------------------------------------

create table public.change_log (
  id bigint generated always as identity primary key,
  project_id text not null references public.projects (id) on delete cascade,
  record_type text not null check (record_type in ('invoice', 'po', 'contract')),
  record_id text not null,
  field text not null,
  before text not null,
  after text not null,
  at timestamptz not null default now(),
  by_id text not null,
  note_he text
);
create index change_log_record_idx on public.change_log (project_id, record_type, record_id, at);
create index change_log_at_idx on public.change_log (project_id, at desc);

create or replace function public.section_label(p_project_id text, p_section_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select s.id || '-' || s.short_name_he
  from public.sections s
  where s.project_id = p_project_id and s.id = p_section_id
$$;

create or replace function public.fmt_num(v numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(trailing '.' from trim(trailing '0' from to_char(v, 'FM999,999,999,999.9999')))
$$;

create or replace function public.log_invoice_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor text := coalesce(new.updated_by, 'SYSTEM');
begin
  if current_setting('app.skip_log', true) = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- seed rows carry no editor and are not logged; rows keyed in through the app or the agent are
    if new.updated_by is not null then
      insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
      values (new.project_id, 'invoice', new.id::text, 'קליטה', '—',
              'חשבון נקלט · סעיף תקציבי ' || public.section_label(new.project_id, new.section_id), actor, new.update_note_he);
    end if;
    return new;
  end if;
  if new.section_id is distinct from old.section_id then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'invoice', new.id::text, 'סעיף תקציבי',
            public.section_label(new.project_id, old.section_id), public.section_label(new.project_id, new.section_id), actor, new.update_note_he);
  end if;
  if new.building is distinct from old.building then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'invoice', new.id::text, 'בניין', coalesce(old.building, '—'), coalesce(new.building, '—'), actor, new.update_note_he);
  end if;
  if new.amount is distinct from old.amount then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'invoice', new.id::text, 'סכום', public.fmt_num(old.amount) || ' ₪', public.fmt_num(new.amount) || ' ₪', actor, new.update_note_he);
  end if;
  if new.status is distinct from old.status then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'invoice', new.id::text, 'סטטוס', old.status, new.status, actor, new.update_note_he);
  end if;
  if new.description_he is distinct from old.description_he then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'invoice', new.id::text, 'תיאור', old.description_he, new.description_he, actor, new.update_note_he);
  end if;
  if new.supplier_doc_no is distinct from old.supplier_doc_no then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'invoice', new.id::text, 'מס׳ מסמך ספק', old.supplier_doc_no, new.supplier_doc_no, actor, new.update_note_he);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger invoices_change_log
before insert or update on public.invoices
for each row execute function public.log_invoice_changes();

create or replace function public.log_po_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor text := coalesce(new.updated_by, 'SYSTEM');
begin
  if current_setting('app.skip_log', true) = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.updated_by is not null then
      insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
      values (new.project_id, 'po', new.id::text, 'קליטה', '—', 'הזמנה נקלטה · ' || public.fmt_num(new.qty) || ' ' || new.unit || ' × ' || public.fmt_num(new.unit_price), actor, new.update_note_he);
    end if;
    return new;
  end if;
  if new.qty is distinct from old.qty or new.unit is distinct from old.unit or new.unit_price is distinct from old.unit_price then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'po', new.id::text, 'כמות / יחידה / מחיר יח׳',
            public.fmt_num(old.qty) || ' ' || old.unit || ' × ' || public.fmt_num(old.unit_price),
            public.fmt_num(new.qty) || ' ' || new.unit || ' × ' || public.fmt_num(new.unit_price), actor, new.update_note_he);
  end if;
  if new.amount is distinct from old.amount then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'po', new.id::text, 'סכום', public.fmt_num(old.amount) || ' ₪', public.fmt_num(new.amount) || ' ₪', actor, new.update_note_he);
  end if;
  if new.status is distinct from old.status then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'po', new.id::text, 'סטטוס', old.status, new.status, actor, new.update_note_he);
  end if;
  if new.section_id is distinct from old.section_id then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'po', new.id::text, 'סעיף תקציבי',
            public.section_label(new.project_id, old.section_id), public.section_label(new.project_id, new.section_id), actor, new.update_note_he);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger purchase_orders_change_log
before insert or update on public.purchase_orders
for each row execute function public.log_po_changes();

-- ---------------------------------------------------------------------------
-- Control sessions: findings, decisions, adjustments, corrections, audit, report versions
-- ---------------------------------------------------------------------------

create table public.controls (
  project_id text not null references public.projects (id) on delete cascade,
  control_date date not null,
  status text not null default 'idle' check (status in ('idle', 'running', 'reviewing', 'report')),
  requested_at timestamptz,
  finalized boolean not null default false,
  operator_id text,
  report_config jsonb not null default '{"includeTrends": false, "splitByBuilding": false, "ceoVersion": false, "execSummaryMaxLines": 5, "savedAs": null}',
  findings jsonb not null default '[]',
  positives jsonb not null default '[]',
  checked_he text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, control_date)
);

create table public.decisions (
  project_id text not null,
  control_date date not null,
  finding_id text not null,
  status text not null check (status in ('open', 'handled', 'pending_execution', 'referred', 'forecast_only')),
  choice_id text,
  free_text_he text,
  route_id text,
  owner_id text,
  audit_he text,
  verified_he text,
  resolved_at timestamptz,
  pending jsonb,
  updated_at timestamptz not null default now(),
  primary key (project_id, control_date, finding_id),
  foreign key (project_id, control_date) references public.controls (project_id, control_date) on delete cascade
);

create table public.forecast_adjustments (
  project_id text not null,
  control_date date not null,
  id text not null,
  section_id text not null,
  change_type text not null check (change_type in ('price', 'quantity', 'scope', 'coverage_gap', 'basis', 'indexation', 'schedule', 'claim', 'contingency')),
  description_he text not null,
  basis_he text not null,
  basis text not null check (basis in ('contract', 'po', 'quote', 'appendix', 'estimate')),
  source_ref text not null,
  document_id text,
  amount bigint not null,
  finding_id text,
  qty numeric,
  unit text,
  unit_price numeric,
  replaces_line_id text,
  committed_portion jsonb,
  created_at timestamptz not null default now(),
  primary key (project_id, control_date, id),
  foreign key (project_id, control_date) references public.controls (project_id, control_date) on delete cascade,
  foreign key (project_id, section_id) references public.sections (project_id, id)
);

create table public.data_corrections (
  project_id text not null,
  control_date date not null,
  id text not null,
  record_type text not null check (record_type in ('invoice', 'po')),
  record_id text not null,
  field_he text not null,
  before_he text not null,
  after_he text not null,
  approved_by_id text not null,
  cross_section_he text not null,
  finding_id text not null,
  at timestamptz not null default now(),
  status text not null check (status in ('applied', 'pending_execution')),
  primary key (project_id, control_date, id),
  foreign key (project_id, control_date) references public.controls (project_id, control_date) on delete cascade
);

create table public.audit (
  id bigint generated always as identity primary key,
  project_id text not null references public.projects (id) on delete cascade,
  at timestamptz not null default now(),
  by_id text not null,
  text_he text not null,
  record_ref jsonb
);
create index audit_project_idx on public.audit (project_id, at desc);

create table public.report_versions (
  id bigint generated always as identity primary key,
  project_id text not null references public.projects (id) on delete cascade,
  control_date date not null,
  label text,
  created_at timestamptz not null default now(),
  created_by text not null,
  model jsonb not null,
  docx_path text
);
create index report_versions_idx on public.report_versions (project_id, control_date, created_at desc);

-- ---------------------------------------------------------------------------
-- Seed copy and reset
-- ---------------------------------------------------------------------------

create table seed.projects (like public.projects including all);
create table seed.people (like public.people including all);
create table seed.suppliers (like public.suppliers including all);
create table seed.sections (like public.sections including all);
create table seed.documents (like public.documents including all);
create table seed.contracts (like public.contracts including all);
create table seed.purchase_orders (like public.purchase_orders including all);
create table seed.invoices (like public.invoices including all);
create table seed.boq_lines (like public.boq_lines including all);
create table seed.forecast_versions (like public.forecast_versions including all);
create table seed.forecast_sections (like public.forecast_sections including all);
create table seed.forecast_lines (like public.forecast_lines including all);
create table seed.open_issues (like public.open_issues including all);
create table seed.change_log (like public.change_log including defaults including constraints including indexes);

-- Takes a snapshot of a project's current data as its seed (used once after loading the data).
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

-- "Reset to seed": restores the ERP data and the change log of a project and clears its control sessions.
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

  delete from public.report_versions where project_id = p_project_id;
  delete from public.audit where project_id = p_project_id;
  delete from public.controls where project_id = p_project_id;   -- cascades to decisions, adjustments, corrections
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

-- ---------------------------------------------------------------------------
-- Access: tables are no longer auto-exposed to the Data API (changelog 2026-04-28), so grant
-- explicitly. Prototype decision: open read/write through the publishable key, RLS on with a
-- permissive policy per table (tighten here later).
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

grant usage on schema seed to anon, authenticated;
grant select, insert, delete on all tables in schema seed to anon, authenticated;
grant usage, select on all sequences in schema seed to anon, authenticated;

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "prototype open access" on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
  for t in
    select tablename from pg_tables where schemaname = 'seed'
  loop
    execute format('alter table seed.%I enable row level security', t);
    execute format('create policy "prototype open access" on seed.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end;
$$;
