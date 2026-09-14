-- A conversation remembers the channel context its Claude session was created with (a hash of the
-- appended system prompt: who is in it, the report link, the channel rules). Claude Code snapshots the
-- system prompt for a session, so when the context changes the relay starts a new conversation.
alter table public.conversations add column if not exists context_key text;
