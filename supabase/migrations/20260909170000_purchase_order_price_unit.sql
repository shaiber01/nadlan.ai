-- Purchase orders: the unit the price is quoted in, beside the unit the quantity is measured in.
--
-- An order's value is the quantity converted into `price_unit`, times `unit_price` — so a supplier who
-- quotes 4,800 ₪ לטון and delivers 12,000 ק״ג can be recorded as keyed, with the order still worth
-- 57,600 ₪. Existing rows keep their single unit: price_unit is backfilled from unit.

alter table public.purchase_orders add column if not exists price_unit text;
update public.purchase_orders set price_unit = unit where price_unit is null;
alter table public.purchase_orders alter column price_unit set not null;

alter table seed.purchase_orders add column if not exists price_unit text;
update seed.purchase_orders set price_unit = unit where price_unit is null;

comment on column public.purchase_orders.price_unit is 'Unit the unit_price is quoted in; the quantity is converted into it before multiplying (usually equal to unit).';

-- The change log records the price unit too, so a correction that only restates the units is visible.
create or replace function public.log_po_changes() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text := coalesce(new.updated_by, 'SYSTEM');
begin
  if tg_op = 'INSERT' then
    if new.updated_by is not null then
      insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
      values (new.project_id, 'po', new.id::text, 'קליטה', '—', 'הזמנה נקלטה · ' || public.fmt_num(new.qty) || ' ' || new.unit || ' × ' || public.fmt_num(new.unit_price) || ' ₪ ל' || new.price_unit, actor, new.update_note_he);
    end if;
    return new;
  end if;
  if new.qty is distinct from old.qty or new.unit is distinct from old.unit or new.price_unit is distinct from old.price_unit or new.unit_price is distinct from old.unit_price then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'po', new.id::text, 'כמות / יחידה / מחיר יח׳',
            public.fmt_num(old.qty) || ' ' || old.unit || ' × ' || public.fmt_num(old.unit_price) || ' ₪ ל' || old.price_unit,
            public.fmt_num(new.qty) || ' ' || new.unit || ' × ' || public.fmt_num(new.unit_price) || ' ₪ ל' || new.price_unit, actor, new.update_note_he);
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
