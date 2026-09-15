-- A heartbeat that found nothing to decide is logged, not messaged: the quiet one-liner is off by default.
alter table public.monitor_settings alter column notify_on_quiet set default false;
update public.monitor_settings set notify_on_quiet = false;
