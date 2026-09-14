-- Instant reaction: with wake_on_change the daemon probes as soon as the ERP changes (a change-log row) or a
-- document is uploaded or replaced, and the interval is only the ceiling (the safety net when Realtime drops).
alter table public.monitor_settings add column if not exists wake_on_change boolean not null default true;
