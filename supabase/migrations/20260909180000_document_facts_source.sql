-- Facts extracted from a document carry their provenance: the seed, the agent reading the document, or an
-- extraction service; the checks run on the facts, so the report can say where they came from.
alter table public.documents add column if not exists facts_source jsonb;
alter table seed.documents add column if not exists facts_source jsonb;
