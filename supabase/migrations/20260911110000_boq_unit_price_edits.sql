-- A BOQ line's unit price can be edited in the ERP (from the covering contract's price schedule). The edit is
-- attributed like invoice and order edits (updated_by / update_note_he) and the trigger writes the change log
-- as record_type 'boq_line' (record_id = the line id), so the heartbeat sees the change and the agent can read it.
alter table public.boq_lines
  add column if not exists updated_by text,
  add column if not exists update_note_he text,
  add column if not exists updated_at timestamptz not null default now();
alter table seed.boq_lines
  add column if not exists updated_by text,
  add column if not exists update_note_he text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.change_log drop constraint if exists change_log_record_type_check;
alter table public.change_log add constraint change_log_record_type_check check (record_type in ('invoice', 'po', 'contract', 'budget', 'document', 'boq_line'));
alter table seed.change_log drop constraint if exists change_log_record_type_check;
alter table seed.change_log add constraint change_log_record_type_check check (record_type in ('invoice', 'po', 'contract', 'budget', 'document', 'boq_line'));

create or replace function public.log_boq_line_changes()
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
  if new.unit_price is distinct from old.unit_price then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'boq_line', new.id, 'מחיר יח׳',
            coalesce(public.fmt_num(old.unit_price) || ' ₪/' || old.unit, '—'),
            coalesce(public.fmt_num(new.unit_price) || ' ₪/' || new.unit, '—'), actor, new.update_note_he);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists boq_lines_change_log on public.boq_lines;
create trigger boq_lines_change_log
before update on public.boq_lines
for each row execute function public.log_boq_line_changes();
