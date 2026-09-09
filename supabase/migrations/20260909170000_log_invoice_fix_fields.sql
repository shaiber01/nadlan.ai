-- The change log also records corrections of retention, cumulative amounts, dates and approval — the
-- fields the data-quality cards fix on approval.
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
  if new.approved_by is distinct from old.approved_by then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'invoice', new.id::text, 'אושר על ידי', coalesce(old.approved_by, '—'), coalesce(new.approved_by, '—'), actor, new.update_note_he);
  end if;
  if new.description_he is distinct from old.description_he then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'invoice', new.id::text, 'תיאור', old.description_he, new.description_he, actor, new.update_note_he);
  end if;
  if new.supplier_doc_no is distinct from old.supplier_doc_no then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'invoice', new.id::text, 'מס׳ מסמך ספק', old.supplier_doc_no, new.supplier_doc_no, actor, new.update_note_he);
  end if;
  if new.retention_pct is distinct from old.retention_pct or new.retention_amt is distinct from old.retention_amt or new.net_payable is distinct from old.net_payable then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'invoice', new.id::text, 'עכבון',
            old.retention_pct::text || '% · ' || public.fmt_num(old.retention_amt) || ' ₪ · לתשלום ' || public.fmt_num(old.net_payable) || ' ₪',
            new.retention_pct::text || '% · ' || public.fmt_num(new.retention_amt) || ' ₪ · לתשלום ' || public.fmt_num(new.net_payable) || ' ₪', actor, new.update_note_he);
  end if;
  if new.cumulative_prev is distinct from old.cumulative_prev or new.cumulative_now is distinct from old.cumulative_now then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'invoice', new.id::text, 'מצטבר',
            coalesce(public.fmt_num(old.cumulative_prev), '—') || ' → ' || coalesce(public.fmt_num(old.cumulative_now), '—'),
            coalesce(public.fmt_num(new.cumulative_prev), '—') || ' → ' || coalesce(public.fmt_num(new.cumulative_now), '—'), actor, new.update_note_he);
  end if;
  if new.date is distinct from old.date or new.date_received is distinct from old.date_received then
    insert into public.change_log (project_id, record_type, record_id, field, before, after, by_id, note_he)
    values (new.project_id, 'invoice', new.id::text, 'תאריכים',
            to_char(old.date, 'DD.MM.YYYY') || ' / התקבל ' || to_char(old.date_received, 'DD.MM.YYYY'),
            to_char(new.date, 'DD.MM.YYYY') || ' / התקבל ' || to_char(new.date_received, 'DD.MM.YYYY'), actor, new.update_note_he);
  end if;
  new.updated_at := now();
  return new;
end;
$$;
