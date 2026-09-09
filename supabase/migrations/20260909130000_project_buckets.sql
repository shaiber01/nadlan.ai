-- The non-building buckets of the per-building split are the project's own: the id is what invoices carry
-- in `building`, the label is what reports show.
alter table public.projects add column if not exists buckets jsonb not null default '{"shared":{"id":"משותף","label_he":"משותף"},"parking":{"id":"חניון","label_he":"חניון"}}';
alter table seed.projects add column if not exists buckets jsonb not null default '{"shared":{"id":"משותף","label_he":"משותף"},"parking":{"id":"חניון","label_he":"חניון"}}';
