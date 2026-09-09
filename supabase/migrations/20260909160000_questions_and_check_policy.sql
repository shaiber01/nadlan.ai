-- People have a channel the full system would use to reach them with a question; projects carry a
-- data-quality check policy; questions the controller puts to people are part of the control session.
alter table public.people add column if not exists channel text check (channel is null or channel in ('whatsapp', 'email', 'phone'));
alter table seed.people add column if not exists channel text;

alter table public.projects add column if not exists check_policy jsonb not null default '{"review_aging_days":30}';
alter table seed.projects add column if not exists check_policy jsonb not null default '{"review_aging_days":30}';

create table if not exists public.questions (
  project_id text not null,
  control_date date not null,
  id text not null,
  to_id text not null,
  channel text not null check (channel in ('whatsapp', 'email', 'phone')),
  text_he text not null,
  finding_id text,
  asked_at timestamptz not null default now(),
  asked_by_id text not null,
  status text not null check (status in ('open', 'answered')),
  answer_he text,
  answered_at timestamptz,
  answered_by_id text,
  primary key (project_id, control_date, id),
  foreign key (project_id, control_date) references public.controls (project_id, control_date) on delete cascade,
  foreign key (project_id, to_id) references public.people (project_id, id)
);
create index if not exists questions_to_idx on public.questions (project_id, to_id);
alter table public.questions enable row level security;
create policy "prototype open access" on public.questions for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.questions to anon, authenticated;
alter publication supabase_realtime add table public.questions;
