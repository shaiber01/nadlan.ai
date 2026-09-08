-- The web app's report tab is a live view of the agent's control session: follow the session tables too.
alter publication supabase_realtime add table public.controls, public.decisions, public.forecast_adjustments, public.data_corrections, public.open_issues, public.audit, public.projects;
