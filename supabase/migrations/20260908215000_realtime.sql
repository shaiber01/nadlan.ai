-- Let the web app follow edits made elsewhere (the agent, SQL, another browser) through Realtime.
alter publication supabase_realtime add table public.invoices, public.purchase_orders, public.change_log, public.report_versions;
