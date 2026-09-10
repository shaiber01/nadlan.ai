-- Deleting a document from the folder leaves a trace in the change log (record_type 'document': who removed
-- which file, and the record it belonged to). The seed twin gets the same constraint so snapshots keep copying.
alter table public.change_log drop constraint if exists change_log_record_type_check;
alter table public.change_log add constraint change_log_record_type_check check (record_type in ('invoice', 'po', 'contract', 'budget', 'document'));
alter table seed.change_log drop constraint if exists change_log_record_type_check;
alter table seed.change_log add constraint change_log_record_type_check check (record_type in ('invoice', 'po', 'contract', 'budget', 'document'));
