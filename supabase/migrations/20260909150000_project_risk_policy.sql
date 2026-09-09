-- The assumptions behind the report's derived risks (§7) are a project setting: the exposure assumed when an
-- estimate rests on a quote that may expire, and the price step used to express appendix-price exposure.
alter table public.projects add column if not exists risk_policy jsonb not null default '{"quote_expiry_exposure_pct":25,"price_step":100}';
alter table seed.projects add column if not exists risk_policy jsonb not null default '{"quote_expiry_exposure_pct":25,"price_step":100}';
