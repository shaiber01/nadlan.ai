-- The optional monitor and messaging layer (docs/heartbeat-bot-plan.md §4.1, §6.5): the heartbeat settings
-- of a project, the enrolled contacts, the conversations (the Claude session per project) and the message
-- inbox. Outside the seed and outside reset_project(): no foreign keys to projects or people, which reset
-- deletes and re-creates. Nothing in the application reads these tables — only the monitor
-- (scripts/monitor.ts, src/hadarim/messaging/) and the presenter strip's switch.

create table if not exists public.monitor_settings (
  project_id            text primary key,
  enabled               boolean not null default false,
  interval_seconds      integer not null default 300 check (interval_seconds >= 15),
  notify_on_quiet       boolean not null default true,
  monitors              jsonb not null default '{}',      -- per-monitor overrides: {"documents": {"intervalSeconds": 60}}
  last_tick_at          timestamptz,                      -- written by the daemon on every tick ("the monitor is alive")
  last_tick_found_work  boolean,
  updated_by            text,
  updated_at            timestamptz not null default now()
);

create table if not exists public.messaging_contacts (
  channel          text not null check (channel in ('whatsapp', 'sms', 'telegram', 'console')),
  address          text not null,                         -- E.164 without "+", a chat id, or the person id on the console
  project_id       text not null,
  person_id        text not null,                         -- the attributed person (byId) for this address
  notify           boolean not null default false,        -- receives the heartbeat's cards
  last_inbound_at  timestamptz,                           -- the 24-hour window, per address
  display_name     text,
  created_at       timestamptz not null default now(),
  primary key (channel, address),
  unique (project_id, person_id, channel)
);

create table if not exists public.conversations (
  id                bigint generated always as identity primary key,
  project_id        text not null,
  scope             text not null check (scope in ('project', 'contact')),
  address           text,                                 -- the contact's address for a 'contact' conversation
  session_id        text not null,                        -- the Claude session
  started_at        timestamptz not null default now(),
  last_turn_at      timestamptz,
  turns             integer not null default 0,
  pending_question  boolean not null default false        -- the last reply waits for an answer
);
create unique index if not exists conversations_scope_idx on public.conversations (project_id, scope, coalesce(address, ''));

create table if not exists public.messages (
  id                   bigint generated always as identity primary key,
  channel              text not null,
  direction            text not null check (direction in ('in', 'out')),
  address              text not null,
  project_id           text,
  person_id            text,
  provider             text,
  provider_message_id  text,
  text                 text,
  media                jsonb,
  status               text not null default 'received', -- in: received|processing|done|failed|ignored · out: sent|held_window_closed|failed|delivered|read
  session_id           text,
  raw                  jsonb,
  at                   timestamptz not null default now(),
  handled_at           timestamptz
);
create unique index if not exists messages_provider_idx on public.messages (provider, provider_message_id) where provider_message_id is not null;
create index if not exists messages_inbox_idx on public.messages (status, id) where direction = 'in';
create index if not exists messages_address_idx on public.messages (channel, address, id desc);

-- The prototype's access model: open through the publishable key, one permissive policy per table.
alter table public.monitor_settings enable row level security;
alter table public.messaging_contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
create policy "prototype open access" on public.monitor_settings for all to anon, authenticated using (true) with check (true);
create policy "prototype open access" on public.messaging_contacts for all to anon, authenticated using (true) with check (true);
create policy "prototype open access" on public.conversations for all to anon, authenticated using (true) with check (true);
create policy "prototype open access" on public.messages for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.monitor_settings, public.messaging_contacts, public.conversations, public.messages to anon, authenticated;

-- The daemon and the presenter strip follow the settings; the daemon follows the inbox.
alter publication supabase_realtime add table public.monitor_settings, public.messages;
