-- A document replaced by a newer upload against the same record: the old row stays in the folder, marked,
-- and the record's card, the checks and the agent's pending list use the current one. Same column on the
-- seed twin so snapshot_project_seed / reset_project (insert ... select *) keep matching column lists.
alter table public.documents add column superseded_by text;
alter table seed.documents add column superseded_by text;
comment on column public.documents.superseded_by is 'id of the document (same project) that replaced this one; null = current';
create index documents_superseded_idx on public.documents (project_id, superseded_by) where superseded_by is not null;
