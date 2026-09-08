-- Data corrections may be recorded outside a control finding (an instructed re-allocation or order fix),
-- so the finding reference becomes optional.
alter table public.data_corrections alter column finding_id drop not null;
