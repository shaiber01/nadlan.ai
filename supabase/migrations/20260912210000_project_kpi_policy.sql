-- The report's cost and quantity indices (standard §2א) are benchmarked against reference ranges that are a
-- project setting: ₪ per gross m² for the whole project, steel (kg/m²), concrete (m³/m²) and the steel-to-
-- concrete ratio (kg/m³). The defaults are typical bands for residential construction in Israel; the values
-- are keyed by index id so a project can add ranges for other indices.
alter table public.projects add column if not exists kpi_policy jsonb not null default '{"ranges":{"cost_per_sqm":{"min":4500,"max":7500},"steel":{"min":80,"max":130},"concrete":{"min":0.45,"max":0.8},"steel_per_concrete":{"min":100,"max":160}}}';
alter table seed.projects add column if not exists kpi_policy jsonb not null default '{"ranges":{"cost_per_sqm":{"min":4500,"max":7500},"steel":{"min":80,"max":130},"concrete":{"min":0.45,"max":0.8},"steel_per_concrete":{"min":100,"max":160}}}';
