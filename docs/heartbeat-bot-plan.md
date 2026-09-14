# Heartbeat monitor and messaging bot — implementation plan

Written 2026-09-14 from a reading of the code as it is (commit `9ad5fa4`). Status: **approved; phase 0 in progress.** The user took all six decisions the same day (§12; the runtime question is answered in §7.6). Everything else is a recommendation with its reasoning.

## 0. Summary

- **Two optional pieces, both outside the existing flow.** A *monitor* daemon (`npm run monitor`, a new script) runs the heartbeat on an interval and relays chat; a *messaging* layer (channel adapters, an inbox table, a webhook hosted as a Supabase Edge Function) connects WhatsApp. Nothing in `engine/`, `tools/`, `features/`, the agent file or the skills changes behaviour.
- **OFF means nothing runs.** The daemon is a separate process nobody has to start, and a per-project `monitor_settings` row (`enabled`, default false) tells a running daemon whether to tick. No existing module reads that row or the messaging tables, so with the daemon stopped, or the row disabled, the system is byte-for-byte what it is today (§3).
- **The interval is one number per project**, `interval_seconds`, in the same settings row; changed from the ERP's presenter strip, the CLI, or the bot in words. The daemon re-reads it every tick and Realtime wakes it when the row changes. The row already has a `monitors` JSON for per-monitor intervals later (§4).
- **A tick is cheap.** Deterministic probe first (two queries, no model): is the change log above the last heartbeat's watermark, or is a document unprocessed? Only then one agent pass — the existing `/bakara-heartbeat` skill — run headless inside the notified person's chat session, so the same session presents the card over WhatsApp with numbered options, receives the reply, and applies the decision through `decide_finding` (§5).
- **Channel: Vonage Messages API sandbox** (decided), with two caveats the design absorbs (100 messages a month; no templates, so an alert needs a conversation window opened by the person within 24 h). Twilio's sandbox is the same-day fallback behind a three-function adapter interface; Meta's Cloud API is the production path; Telegram the zero-friction escape hatch if WhatsApp onboarding blocks a demo (§6).
- **The bot is the laptop agent over another wire**: one `claude -p --agent shraga --resume <session>` process per message, one conversation per project shared by the two notified phones and mirrored to both. Same agent, skills, tools and login — the Max subscription, no API key (§7.6); numbered lists instead of the click-to-choose question tool; `reset_project`, the shell and SQL withheld. It works with the heartbeat off, and the heartbeat works with the bot off (§7).

## 1. What exists today (the analysis)

Read before designing: `docs/system-overview.md`, `.claude/agents/shraga.md`, `.claude/skills/bakara-heartbeat/SKILL.md`, `src/hadarim/engine/heartbeat.ts`, `src/hadarim/tools/index.ts` (heartbeat and question tools), `src/hadarim/db/client.ts`, `scripts/heartbeat.sh`, `scripts/bakara.ts`, `mcp/bakara-server.ts`, the migrations for `heartbeats` and `questions`, `.claude/settings*.json`, `claude --help` (2.1.270), the Claude Code docs on headless mode, sessions and the Agent SDK.

What the plan builds on:

1. **The heartbeat already exists as a pass, not as a schedule.** `get_heartbeat_work` (deterministic: pending documents, change-log rows above the watermark grouped per record, the checks' findings on them) → the agent reads and presents → `record_heartbeat` (watermark, counts, finding ids, Hebrew summary). The watermark is `change_log.id`, so every ERP insert or edit, made in the browser or through the tools, is in scope, and a pass that fails before `record_heartbeat` is simply repeated next time. `scripts/heartbeat.sh` runs it headless (`claude -p --agent shraga`), is not scheduled, and by design decides nothing because nobody is there. The plan adds the schedule and the "somebody is there" part; the pass itself is reused as is.
2. **A cheap "is anything new" test is already available without the model**: `latestChangeLogId()` versus the last heartbeat's `untilChangeLogId` (`list_heartbeats` returns `changesSinceLast`), plus a count of documents with `facts_source is null and superseded_by is null`. This is the probe of §5.
3. **Questions to people are modelled but never sent.** `people.channel` (whatsapp / email / phone), the `questions` table, `ask_person` / `answer_question` (kept out of the agent's tool list), and the agent's rule 9 "do not send anything anywhere and do not talk about channels". The messaging layer gives these a wire later (§10, phase 5) without changing them now.
4. **Policy lives on the project row** (`materiality`, `risk_policy`, `check_policy`, `kpi_policy`, `buckets`, `buildings`). The heartbeat settings could follow that convention, but `reset_project()` deletes and re-inserts `projects` from the `seed` schema, so a heartbeat switch on the project row would flip back to the seed's value on every demo reset. The settings therefore go in their own row (§4), which also keeps `HProject`, `loadPackage` and the generated types untouched.
5. **The same reset behaviour rules out foreign keys from the new tables to `projects` or `people`**: reset deletes both and re-inserts them, so a cascading key would wipe the conversations and contacts, and a restricting key would break reset. The messaging tables carry `project_id` / `person_id` as plain text, validated in code.
6. **The tool registry binds one project per process.** `loadState` calls `setPackage`, and `pkg` is a live module binding the whole engine reads. Every Claude session spawns its own MCP server process (stdio, `npx vite-node mcp/bakara-server.ts`), so sessions do not share it; the daemon must not call the registry in-process for several projects concurrently. The daemon only uses `db/client.ts` reads for the probe and spawns Claude for the pass.
7. **Headless permissions are rule-based.** In `-p` mode anything that would prompt is denied (`--permission-prompts none` makes that explicit); tools are pre-approved with `--allowedTools`, and `mcp__bakara__*` is a valid pattern. Today `.claude/settings.local.json` (per machine, not committed) allows only seven `bakara` tools, so `scripts/heartbeat.sh` as it stands would be denied `search_documents`, `get_document`, `classify_document`, `set_document_facts`, `run_check` and `run_control` on a fresh machine — a latent gap the runner's explicit allow-list closes.
8. **`AskUserQuestion` is not available headless**, and the agent file already specifies the fallback: "present the same options as a numbered list of Hebrew labels, each with its consequence, and wait for the number or free text". That is exactly a WhatsApp conversation. The bot needs no new agent rule for decisions.
9. **Sessions resume by id** (`claude -p --resume <id>` works with `--agent`; `--output-format json` returns `session_id`, `result`, `total_cost_usd`; `--session-id <uuid>` lets the runner pick the id before the run). One session per contact is therefore a stored id, and the transcript lives where Claude Code keeps it.
10. **The agent's system prompt is snapshotted per conversation** (`--system-prompt-snapshot on` is the default): the channel context passed with `--append-system-prompt` must be set on the session's first run and cannot be changed afterwards without a new session. Fine, since a contact's identity and role are stable.
11. **The Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk` 0.3.270) would let the runner keep the agent in-process, relay `AskUserQuestion` through its `canUseTool` callback (so cards could become WhatsApp interactive lists), and avoid a process spawn per message. Per the docs it needs `ANTHROPIC_API_KEY` (the claude.ai login is not available to it) and does not load `.claude/agents/*.md` by name (the agent definition would be passed programmatically). Recommended as the upgrade path, not for the demo (§7). Claude Code's own *channels* (Telegram, Discord, iMessage plugins) push into an open interactive session and have no WhatsApp plugin; not applicable.
12. **Realtime is already wired** (`subscribeProject` in `db/client.ts` follows the ERP, session, documents, heartbeats and project tables with a 400 ms debounce); the daemon reuses the client for waking on settings changes and for the inbox.
13. **The report page is public** (`report.html` on GitHub Pages, live and read-only). "Send me the report" over WhatsApp can be a link in phase 3; a Word file needs a public bucket (phase 5).
14. **Hebrew and secrets.** The repository is public: phone numbers, API keys and signature secrets never enter it (`.env` is git-ignored; the Edge Function reads its secrets from Supabase). WhatsApp renders Hebrew RTL correctly and takes plain text up to 4096 characters, no tables; the agent's output needs a small shaping step (§7).

## 2. Architecture

```
                 the existing system (unchanged)                          the new, optional pieces
 ┌──────────────────────────────────────────────────┐    ┌──────────────────────────────────────────────────────────┐
 │ hadarim.html (ERP)   report.html   claude --agent │    │ scripts/monitor.ts  — one Node process, two loops       │
 │        │ writes            │ reads        │ MCP   │    │   scheduler: tick every interval_seconds per project    │
 │        ▼                   ▼              ▼       │    │      probe (db reads) → agent pass (claude -p) → notify │
 │ Supabase: projects, ERP tables, change_log,       │◄───┤   relay: inbox row → contact session (claude -p) → send │
 │   documents, controls…, heartbeats, Realtime      │    │ src/hadarim/messaging/                                   │
 │                                                   │    │   channel.ts (interface) · console.ts · vonage.ts        │
 │                                                   │    │   settings.ts · inbox.ts · session-runner.ts · shape.ts  │
 └──────────────────────────────────────────────────┘    │ supabase/functions/messaging-inbound (Edge Function)      │
                    ▲                                     │   verifies the webhook, inserts the inbox row, 200        │
                    │ new tables, new function             └──────────────────────────────────────────────────────────┘
      monitor_settings · messaging_contacts · messages                    ▲ webhook                     │ send
                                                                          │                             ▼
                                                                    Vonage Messages API  ◄──►  WhatsApp on the person's phone
```

Three components, each independently present or absent:

| Component | What it is | Runs where | Present when |
| --- | --- | --- | --- |
| **Monitor daemon** `scripts/monitor.ts` | The scheduler (heartbeat ticks) and the relay (chat turns), one process, each loop switchable | The laptop where `claude` is logged in (a terminal window for the demo; launchd later) | Somebody runs `npm run monitor` |
| **Messaging layer** `src/hadarim/messaging/` | Channel adapters behind one interface; settings, inbox and contacts access; the session runner (`claude -p` wrapper); message shaping | Inside the daemon (and the settings part inside the ERP's presenter strip) | Imported only by the daemon and the strip control |
| **Inbound webhook** `supabase/functions/messaging-inbound/` | Verifies Vonage's signed webhook, normalises the message, inserts it into `messages`, answers 200 | Supabase Edge Functions (public HTTPS URL, no tunnel) | Deployed only when a real channel is configured |

Boundaries, stated as rules for the implementation:

- The daemon and the messaging module import from the existing code (`db/client.ts` reads, `db/config.ts`, the types) and are imported by nothing existing, except the optional presenter-strip control. The dependency arrow points one way.
- The daemon does not call the tool registry in-process; every pass or chat turn is a `claude` process with its own MCP server, exactly like the terminal.
- No engine, check, report or ERP code changes. The agent file gains at most a tool name (phase 4) and the skills a sentence about the scheduled run already covered.
- The three new tables and the function are additive migrations; `reset_project()` is not modified and does not touch them.

## 3. The ON/OFF contract

Two levels, so "off" is checkable at a glance and "on" is one click:

| State | Timers | Polling / Realtime subscriptions | Processes spawned | Messages sent | Existing behaviour |
| --- | --- | --- | --- | --- | --- |
| Daemon not running (the default today and after this work) | none | none | none | none | unchanged |
| Daemon running, `monitor_settings.enabled = false` (or no row) for every project, no channel configured | none | one Realtime subscription on `monitor_settings` so a switch-on is noticed (no polling) | none | none | unchanged |
| Daemon running, heartbeat enabled, no channel | one `setTimeout` per enabled project | the same subscription | one `claude -p` per tick that finds work | none — the summary goes to the log and to `heartbeats.summary_he`, as `heartbeat.sh` does today | unchanged; the heartbeat rows and any agent-processed documents appear as they do after a manual `/bakara-heartbeat` |
| Daemon running, channel configured, heartbeat disabled | none | the inbox subscription (plus a 10 s safety poll of `messages` while the channel is on) | one `claude -p` per inbound message | replies only | unchanged — the bot is a user of the tools like the terminal |
| Both on | per-project timer | both subscriptions | as above | alerts and replies | unchanged |

How the guarantee is kept honest:

- **Nothing existing reads the new state.** `monitor_settings`, `messaging_contacts` and `messages` are read only by `src/hadarim/messaging/*`, and that folder is imported only by `scripts/monitor.ts` and the presenter-strip control. A grep in the test suite (`tests/hadarim.monitor.test.ts`) asserts that no file under `engine/`, `tools/`, `db/` or `features/` outside the strip control imports `messaging/`.
- **The scheduler is a pure function over the settings and a clock** (`nextTick(settings, now, lastRun)`), tested with fake timers: with `enabled=false` it returns `null` and the daemon holds no timer (`vi.getTimerCount() === 0`).
- **A disabled project is skipped before any read** beyond the settings row. The probe, the pass, the contact lookup all sit behind `if (!settings.enabled) return`.
- **The agent, the skills and the tools do not know the daemon exists.** The heartbeat pass the daemon runs is the same `/bakara-heartbeat` a person runs; the bot's turns are the same agent turns. Switching the daemon off leaves no half-state: a pass that was cut short is repeated from the watermark; a chat that was cut short is a session that simply gets no next message.
- **The one place a person sees it** is the presenter strip's switch (phase 1). When the daemon is not running, the switch shows "המנטר לא פועל" next to the setting, so an enabled row with no daemon is never mistaken for a working heartbeat.

## 4. Configuration

### 4.1 Where it lives

One row per project in a new table, outside the seed and outside reset:

```sql
create table public.monitor_settings (
  project_id        text primary key,                      -- no FK: reset re-creates projects, this row must survive it
  enabled           boolean not null default false,
  interval_seconds  integer not null default 300 check (interval_seconds >= 15),
  notify_on_quiet   boolean not null default true,         -- a one-line summary when the pass found nothing to decide
  monitors          jsonb not null default '{}',           -- per-monitor overrides, see 4.3; empty = the default interval for all
  updated_by        text,
  updated_at        timestamptz not null default now()
);
-- RLS on, the prototype's permissive policy, grants to anon/authenticated, added to the supabase_realtime publication
```

Who receives the heartbeat's cards is not in this row: it is the contacts flagged `notify` in `messaging_contacts` (§6.5), because phone numbers are enrolled on the machine and never committed.

Why a table and not `projects.heartbeat_policy` (the convention for policy): `reset_project()` restores `projects` from `seed.projects`, so a switch on the project row would reset to OFF (or to whatever the seed says) on every demo reset; and keeping the row separate means no change to `HProject`, `loadPackage`, the generator, the seed script or `db/types.ts` beyond the regenerated types. The defaults of the standard live in code as `STANDARD_MONITOR_SETTINGS` in `messaging/settings.ts` (not in `data/types.ts`, so the engine stays ignorant of them), and a project with no row behaves as disabled.

Secrets and machine facts stay in the environment (`.env`, git-ignored; `.env.example` committed):

```
MONITOR_CHANNEL=console | vonage          # which adapter the daemon loads (unset: no channel, heartbeat-only)
VONAGE_API_KEY, VONAGE_API_SECRET         # sandbox auth
VONAGE_SANDBOX_NUMBER=14157386102         # the sandbox's WhatsApp number (from the dashboard)
VONAGE_SIGNATURE_SECRET                   # also set as an Edge Function secret for webhook verification
CLAUDE_BIN=claude                         # the CLI to spawn (a stub in tests)
MONITOR_MAX_BUDGET_USD=3                  # passed as --max-budget-usd per run
MONITOR_MODEL=                            # optional --model override; empty = the agent's default
```

### 4.2 How it is changed

| Way | What | Phase |
| --- | --- | --- |
| ERP presenter strip (decided: phase 1) | A small control next to the offline switch: on/off, "בדוק שינויים כל ___ שניות", the notified contacts (read-only: name and masked number of every contact flagged `notify`; enrolment is a CLI step because phone numbers never enter the repository), and the daemon's state (`enabled` plus the last tick the daemon writes — see 5.4). Writes the row through `messaging/settings.ts` with the "מבצע" person as `updated_by`. | 1 |
| CLI | `npm run monitor -- settings [--on|--off] [--interval 60]` prints and edits the row; `npm run monitor -- contact add --person EYAL --whatsapp 9725xxxxxxx --notify` enrols a phone; `npm run monitor -- status` shows the daemon's view. | 1 |
| The bot / the agent | `set_monitor_settings` and `get_monitor_settings` tools (kind write / read) in the registry, added to the agent's list and mentioned in `/bakara-heartbeat`, so "הפעל פעימת לב כל דקה" over WhatsApp works. Optional. | 4 |
| SQL | `update monitor_settings set interval_seconds = 60 where project_id = 'HADARIM'` | — |

The daemon reads the row at every tick (one indexed read) and subscribes to its Realtime changes, so an edit takes effect within a second: a longer interval reschedules the pending timer, OFF cancels it, ON starts one.

### 4.3 Per-monitor frequencies later

The daemon is written around a `Monitor` interface from day one, with two implementations in phase 1:

```ts
interface Monitor {
  id: "documents" | "erp";            // later: "tasks" (due dates), "report" (cutoff approaching), …
  due(settings, now, lastRunAt): boolean;      // interval from settings.monitors[id]?.intervalSeconds ?? settings.interval_seconds
  probe(projectId): Promise<Work | null>;      // deterministic, no model
}
```

`monitors` in the row is `{ "documents": { "intervalSeconds": 60 }, "erp": { "intervalSeconds": 600 } }` when the user wants different cadences; empty for the demo. A tick evaluates every due monitor; when any has work, one agent pass runs (the pass tool already covers both documents and ERP changes, and one `record_heartbeat` closes both, as today). The UI stays one number until a second cadence is wanted.

## 5. Heartbeat execution

### 5.1 One tick

```
tick(projectId):
  s = readSettings(projectId)                       # 1 read
  if !s.enabled: cancel timer; return               # the OFF guard, before anything else
  if busy[projectId]: schedule(s.interval); return  # no overlapping passes; the watermark makes a skipped tick harmless
  work = probe(projectId)                           # 2–3 reads, no model:
        #   latestChangeLogId(projectId) > (lastHeartbeat?.untilChangeLogId ?? 0)   → ERP changes
        #   count(documents where facts_source is null and superseded_by is null) > 0 → pending documents
  writeMonitorHeartbeat(projectId, now, work)       # "the daemon is alive" for the strip and the status command
  if !work: schedule(s.interval); return            # quiet tick: no process, no message, no cost
  busy[projectId] = true
  try:
    recipients = channelOn ? notifiedContacts(projectId) : []          # contacts flagged notify (the two phones)
    if recipients.length:  runPassInConversation(projectId, recipients, work)   # 5.2
    else:                  runPassAlone(projectId, work)                        # 5.3 — today's heartbeat.sh, done right
  finally:
    busy[projectId] = false
    schedule(s.interval)                            # measured from the end of the pass, so a long pass never stacks ticks
```

The timer is a `setTimeout` chain, never `setInterval`; the delay is re-read each time, so an interval change applies at the next scheduling. Failures back off: after two consecutive failed passes the project waits ten intervals and the operator sees it in the log and the strip (no WhatsApp spam about the daemon's own trouble).

### 5.2 A pass with people on the other end

The pass runs *inside the project's conversation* — one Claude session per project, shared by the contacts flagged `notify` (decision 4: the two phones), every outbound message mirrored to each of them and every inbound message prefixed with its sender — so the card, the replies and the decision live in one transcript and both phones see the outcome:

1. The runner resumes (or creates) the project's conversation and sends the user turn: `פעימת לב. הרץ /bakara-heartbeat. יש משתמשים: אתה משוחח בוואטסאפ עם <names>. ממצא שדורש החלטה — הצג כרטיס אחד, שאל שאלה אחת עם אפשרויות ממוספרות ועצור; כשאין מה להחליט — סכם בשורה אחת.`
2. The agent does what the skill says: processes pending documents (reads them with `Read`, classifies, records facts, re-checks the record), reads changed records against their contracts, and presents findings. With a control open it uses `raise_finding` for its own reading; the checks' findings come with their `proposedFix` and `people`.
3. Its text output becomes the WhatsApp message(s) to every notified contact: the card's four blocks and a numbered list of options with their consequences (the agent's existing no-question-tool fallback), ending with the question.
4. The reply ("1", "2", or free text) from either phone arrives through the inbox and resumes the same session as the next user turn, prefixed with the sender ("רועי: 1"), so the decision is attributed to the person who took it. The agent maps the number to the option id and calls `decide_finding` (or `confirm_quote`, `route_finding`), quotes the verification line, and shows the next card or closes.
5. When nothing is left to ask, the agent ends with `record_heartbeat` as the skill prescribes (watermark = the `untilChangeLogId` the work tool returned, the finding ids presented, the summary). If the person never answers, the finding stays open and recorded as presented; the next pass does not repeat it unless its record changes again — the existing once-only rule. A reminder cadence is a phase-5 setting, not a v1 behaviour.

Two ordering rules keep one conversation sane: a heartbeat prompt is queued behind an unanswered question in the same session (a second open question is worse than a ten-minute delay; the watermark keeps the work), and inbound messages that arrive while a turn runs wait their turn (§7.3).

Corrections the person approves are ERP writes, logged by the triggers above the pass's watermark; the next tick sees them as changed records and the checks find them consistent, so the pass is short. `record_heartbeat` is called by the agent when the conversation's decisions are done, which is why the watermark is the one the work tool returned and not "now".

### 5.3 A pass with nobody there

No contact for the notified person, or no channel configured: the runner starts a fresh, unattended session with today's `heartbeat.sh` prompt ("אין משתמש בצד השני — עבד מסמכים, בדוק שינויים, אל תחליט ואל תתקן דבר, רשום את הפעימה וסכם בעברית"), with the proper allow-list (§7.2), and writes the result to the log. The summary is in `heartbeats.summary_he`, visible through `list_heartbeats` and the report's readiness. This is the heartbeat-without-bot mode of §3 and it replaces the crontab recipe; `scripts/heartbeat.sh` stays as the one-shot entry point (with its allow-list fixed).

### 5.4 Cost and pace

- A quiet tick costs three database reads. The model runs only when the probe says there is work, so the interval can be 15–30 seconds for a demo without a bill.
- A pass is a headless agent run with the full tool list; expect tens of seconds and a few tens of thousands of input tokens per turn. `--max-budget-usd` caps a runaway pass; `--model` can pin a cheaper model for the pass while the terminal keeps the default (a setting, not a decision made here).
- The daemon writes `monitor_heartbeat(project_id, at, found_work)` (a small table, or two columns on `monitor_settings`: `last_tick_at`, `last_tick_found_work`) so the ERP strip can show "פועל · בדיקה אחרונה לפני 12 שניות". Two columns on the settings row are enough.

### 5.5 Who is "the relevant person"

Phase 3: the contacts flagged `notify` (decision 4: two phones, each enrolled against a person of the project at setup time — nothing in the daemon or the repository names a person or a number of the scenario). Both receive every card; whoever answers decides, attributed by the sender prefix. The card already names who entered, approved and changed the record (`people`), so the recipients know whom to ask when neither of them knows.

Phase 5: route by the card — the person who keyed the record gets a data-fix card, the project manager the judgment cards — using `people.channel` to pick the adapter and `messaging_contacts` to find the address, falling back to the default recipient when the person has no contact. The routing function is pure (`recipientFor(finding, people, contacts, settings)`) and tested on the generator package.

## 6. The messaging channel

### 6.1 Candidates

| | Vonage Messages API (sandbox) | Twilio Sandbox for WhatsApp | Meta WhatsApp Cloud API (direct) | Telegram Bot API |
| --- | --- | --- | --- | --- |
| Onboarding | Vonage account; scan the sandbox QR / send the join message from each phone; one allow-listed number per channel per API key | Twilio account; each phone sends `join <word>` to the sandbox number; membership expires after 3 days (re-join) | Meta developer account + business portfolio + app; a test number with up to 5 verified recipient phones; temporary token (24 h) unless a system user is created | Talk to @BotFather, get a token; anyone can message the bot |
| Inbound | Webhook (POST JSON), signed with a JWT in `Authorization: Bearer` (HS256 over the account's signature secret, `payload_hash` = SHA-256 of the body) | Webhook (POST form-encoded: `From`, `Body`, `WaId`, `ProfileName`), `X-Twilio-Signature` (HMAC-SHA1), `twilio.validateRequest` | Webhook with a GET verification handshake, then POST JSON; `X-Hub-Signature-256` | Webhook **or long polling** — no public URL needed |
| Outbound | `POST /v1/messages` (`https://messages-sandbox.nexmo.com/v1/messages`), text, image, file; the `@vonage/messages` SDK | `client.messages.create({from: 'whatsapp:+1415…', to: 'whatsapp:+972…', body})`, media by URL | Graph API `POST /<phone id>/messages`; text, media, **interactive list/buttons** | `sendMessage`, inline keyboards, files up to 50 MB |
| Limits | **100 messages/month fair use (429 beyond)**, 1 message/s, **no templates in the sandbox**, 24-hour window applies | 1 message / 3 s, three fixed templates only, 24-hour window applies, sandbox is for functional testing | 1,000 free service conversations/month; business-initiated messages need an approved template (utility templates in Hebrew are usually approved within hours); 24-hour window | none of the above; no windows, no templates, free |
| Path to production | The same API with a real WhatsApp sender registered through Vonage (they front Meta's onboarding) | The same API with a registered sender | It *is* production | Not WhatsApp |
| Fit for "heartbeat sends first" | Only inside a window the person opened in the last 24 h | Same, or one of three irrelevant templates | Proper: a Hebrew utility template opens the conversation | Always |

### 6.2 Recommendation: Vonage sandbox, designed around its two limits

Vonage is the recommended demo channel: sandbox onboarding takes minutes, the inbound webhook is signed (a proper verification step in the Edge Function rather than a shared password in a URL), one SDK call sends text, images and files, the same API later carries SMS and Viber for people whose `channel` is not WhatsApp, and moving to production is a sender registration, not a re-integration. Twilio is a fair equal on every row but the signature scheme and the three-day re-join; Meta direct is the better *product* (templates, interactive lists) at the price of a Meta business setup that is not worth a demo; Telegram is not WhatsApp, which the request names.

The two limits and what the design does about them:

- **100 messages a month.** Rehearsals run on the *console adapter* (§6.4: the same daemon, the same agent, stdin/stdout instead of WhatsApp), so the real channel is used only for the dress rehearsal and the demo. The runner counts outbound messages per month in `messages` and refuses to send past a configurable cap (default 90) with a loud log line, so the demo never ends in a silent 429. One card is one message (shaping in §7.4), and confirmations are one line.
- **No templates, so the business cannot speak first.** WhatsApp lets a business send free text only within 24 hours of the person's last message. The runner stores `last_inbound_at` per contact; when the heartbeat has a card and the window is closed, it does not lose it: the pass still runs (findings are recorded as presented, the summary is written), the outbound message is held in `messages` with `status = 'held_window_closed'`, and the daemon sends it the moment the person writes anything ("היי"). For the demo the presenter sends one message to the sandbox number before starting, which opens 24 hours of alerts. Twilio has the same rule; Meta with a template does not, which is the production answer.

Fallback plan, in order, each a one-file adapter behind the interface of §6.4: Twilio (same day, if the Vonage account or fair-use cap blocks), Telegram (same hour, if WhatsApp onboarding itself blocks and the audience accepts a different app).

### 6.3 Where the webhook lives: an Edge Function that writes an inbox

The daemon runs on a laptop; Vonage needs a public HTTPS URL. Two options:

| | Supabase Edge Function inbox (recommended) | Local HTTP server + ngrok tunnel |
| --- | --- | --- |
| Public URL | Permanent (`https://<ref>.functions.supabase.co/messaging-inbound`) | Changes on every ngrok restart on the free plan; set again in the Vonage dashboard each time |
| Availability | Always up; messages sent while the laptop sleeps are stored and processed when the daemon returns | Lost (Vonage retries for 24 h with backoff, which helps but is not a queue) |
| Moving parts on the laptop | None beyond the daemon | Tunnel process, firewall, one more thing to start before a demo |
| Auditability | Every inbound and outbound message is a row (who, when, text, provider id, status), readable from the ERP later | Only what the daemon logs |
| Code | ~80 lines of Deno: verify the JWT, normalise, insert, 200 | ~60 lines of Node plus the tunnel |
| Cost | Free tier is far above a demo's volume | Free ngrok |

The function is tiny and does one thing: verify the signature against `VONAGE_SIGNATURE_SECRET` (a function secret), normalise the payload to `{ provider, provider_message_id, channel, from, to, text, media, raw }`, insert into `messages` with the service-role key the runtime provides, return 200 fast. Unknown senders are stored with `status = 'ignored'` (so a presenter can see an attempt) and never reach the agent. Vonage's status webhook (delivered / read) points at the same function and updates the outbound row's `status` — phase 5 nicety.

Deployed with `supabase functions deploy messaging-inbound --no-verify-jwt` (the webhook has no Supabase JWT; the Vonage signature is the authentication) or the Supabase MCP's `deploy_edge_function`. Its parsing code lives in `supabase/functions/_shared/vonage.ts`, pure TypeScript without Node or Deno globals, so `vitest` tests it with recorded fixtures.

The daemon consumes the inbox through Realtime on `messages` (insert, `direction = 'in'`) with a 10-second poll as the safety net; both exist only while a channel is configured. It claims a row (`status: received → processing`) before running the turn and closes it (`done`, or `failed` with the error) after, so a crash re-processes nothing twice and loses nothing: on start it re-scans `received` rows.

### 6.4 The adapter interface

```ts
export interface Channel {
  id: "console" | "vonage" | "twilio" | "telegram";
  send(to: Address, text: string): Promise<{ providerMessageId: string }>;
  sendFile?(to: Address, file: { url: string; name: string; mime: string }, caption?: string): Promise<{ providerMessageId: string }>;
  // inbound is not a method: it arrives through the inbox table (webhook) or, for the console, from stdin into the same table
}
```

`console.ts` writes outbound to stdout and turns stdin lines into inbox rows for a chosen person (`--as EYAL`), so a rehearsal is `npm run monitor -- --channel console --as EYAL` in a terminal, with heartbeat alerts appearing in the same window. `vonage.ts` is the SDK call plus the monthly counter and the window rule.

### 6.5 Tables

```sql
create table public.messaging_contacts (
  channel          text not null check (channel in ('whatsapp','sms','telegram','console')),
  address          text not null,                 -- E.164 without '+', or a chat id
  project_id       text not null,                 -- plain text, no FK (reset-safe)
  person_id        text not null,                 -- the attributed person (byId) for this phone
  notify           boolean not null default false, -- receives the heartbeat's cards (decision 4: both demo phones)
  last_inbound_at  timestamptz,                   -- the 24-hour window, per phone
  display_name     text,
  primary key (channel, address),
  unique (project_id, person_id, channel)
);

create table public.conversations (
  id               bigint generated always as identity primary key,
  project_id       text not null,
  scope            text not null check (scope in ('project','contact')),  -- v1: one 'project' row shared by the notified contacts
  address          text,                          -- for a 'contact' conversation (phase 5)
  session_id       text not null,                 -- the Claude session
  started_at       timestamptz not null default now(),
  last_turn_at     timestamptz,
  pending_question boolean not null default false, -- a card is waiting for an answer
  unique (project_id, scope, address)
);

create table public.messages (
  id                  bigint generated always as identity primary key,
  channel             text not null,
  direction           text not null check (direction in ('in','out')),
  address             text not null,
  project_id          text,                       -- null until a contact resolves it
  person_id           text,
  provider            text,
  provider_message_id text,
  text                text,
  media               jsonb,                      -- {url, mime, name} when the person sent a file (phase 5)
  status              text not null default 'received',  -- in: received|processing|done|failed|ignored · out: sent|held_window_closed|failed|delivered|read
  session_id          text,
  raw                 jsonb,
  at                  timestamptz not null default now(),
  handled_at          timestamptz,
  unique (provider, provider_message_id)
);
create index messages_inbox_idx on public.messages (status, id) where direction = 'in';
-- RLS on, the prototype's permissive policy, grants; `messages` and `monitor_settings` added to supabase_realtime
```

Contacts are keyed in by the CLI (`npm run monitor -- contact add --project HADARIM --person EYAL --whatsapp 9725xxxxxxx --notify`), never seeded and never committed. `reset_project()` leaves these tables alone; `npm run monitor -- forget` clears the conversations when a rehearsal should start from a blank thread.

## 7. The conversational bot

### 7.1 The flow

```
WhatsApp → Vonage → Edge Function → messages(in, received)
   → daemon (Realtime) → claim → resolve contact (phone → project, person) → the project's conversation
   → session runner: claude -p --agent shraga --resume <session>  "<text>"
   → result text → shape → channel.send → messages(out, sent) → close the inbox row (done)
```

The bot is the same agent the user runs on the laptop: the project's `.claude/agents/shraga.md`, its skills, `.mcp.json` (loaded automatically in `-p` mode), `CLAUDE.md`, and the machine's Claude login — the Max subscription (§7.6). Parity is by construction, not by re-implementation. What differs:

| On the laptop | Over WhatsApp |
| --- | --- |
| Decisions through the click-to-choose question tool | Numbered options in the message; the reply is the number or free text (the agent's own fallback rule) |
| Permission prompts | An explicit allow-list (7.2); `reset_project` withheld; no shell, no file edits |
| Files dragged into the session | Phase 5: a photo or PDF sent on WhatsApp is downloaded to the document cache and offered to the agent for `add_document` |
| The report as a Word file on disk | Phase 3: a link to the live `report.html`; phase 5: the Word file uploaded to a public `exports` bucket and sent as a WhatsApp document |
| Read-only SQL through the Supabase MCP | Withheld in v1 (the tools cover the QA skill's first path; SQL is its second) — the Supabase MCP's OAuth session is not guaranteed headless and `execute_sql` can write |

### 7.2 The session runner

One wrapper around the CLI, in `messaging/session-runner.ts`, with an interface small enough to swap for the Agent SDK later:

```ts
run(input: { sessionId: string | null; personId; personNameHe; roleHe; text: string; projectId }): Promise<{ sessionId: string; text: string; costUsd: number; error?: string }>
```

The command it spawns (flags verified against `claude --help` 2.1.270):

```
claude -p --agent shraga
  --resume <sessionId>            | --session-id <new uuid>          (first turn: pick the id first, store it, then run)
  --output-format json                                                (result, session_id, total_cost_usd)
  --permission-mode default --permission-prompts none                 (anything not allow-listed is denied, never hangs)
  --allowedTools "mcp__bakara__*" "Read" "Skill"
  --disallowedTools "mcp__bakara__reset_project" "Bash" "Edit" "Write" "WebFetch" "WebSearch"
  --append-system-prompt "<channel context, first turn only — snapshotted for the session>"
  --max-budget-usd $MONITOR_MAX_BUDGET_USD
  [--model $MONITOR_MODEL] [--setting-sources project,local]
  "<the person's text>"
```

The channel context (Hebrew, one paragraph): who is in the conversation (the notified contacts' names, roles and person ids for `byId`), that every inbound message is prefixed with its sender's name, that this is WhatsApp — short messages, plain text, no tables, `*bold*` only, one question per message with numbered options and their consequences, end every message that needs an answer with the question — and that a write is attributed to the person who sent the message that decided it, unless they say someone else decided. Because the system prompt is snapshotted on the first request, the runner passes it only when creating a conversation; when the set of notified contacts changes, the runner starts a new one.

Timeouts and failures: a run is killed after a configurable wall clock (default 5 minutes) and the person gets one line ("לא הצלחתי לסיים, נסה שוב"); the inbox row is `failed` with the stderr tail; `--max-budget-usd` bounds the cost of a runaway turn. The first turn of a session is slower (the MCP server compiles the registry with vite-node, a few seconds); an optional "רגע, בודק…" after 8 seconds is a setting, off by default in the sandbox to save the message budget.

### 7.3 Sessions and ordering

- One conversation per project in v1 (`conversations`, scope `project`), shared by the notified contacts: every message any of them sends goes into it prefixed with the sender's name, and every reply is mirrored to all of them, so the two phones see the same thread, like a group. Created on the first message or the first alert, kept until `forget`, a `/חדש` command, or a rotation rule (a new session after 7 days, so transcripts do not grow without bound). Private per-contact conversations (scope `contact`) are phase 5, with one routing rule: a reply while the project conversation has a pending question goes there, anything else to the sender's private thread.
- One turn at a time per conversation: messages that arrive while a turn runs are queued in the inbox and processed in order; messages queued together are joined into one turn, each with its sender prefix (a person who writes "1" and then "בעצם 2" gets one coherent answer).
- The heartbeat pass is a turn in the same queue (§5.2), so alerts and chat never interleave mid-thought.
- A small command set is handled by the runner, not the agent: `/חדש` (new session), `/סטטוס` (daemon, heartbeat setting, last tick), `/עצור` (mute alerts to this contact until `/המשך`). Everything else is the agent's.

### 7.4 Shaping the agent's text for WhatsApp

`messaging/shape.ts`, pure and tested: headings become bold lines, `**x**` becomes `*x*`, tables become "field: value" lines, code fences are dropped, links kept, numbered lists kept, and text over 3,500 characters is split at paragraph boundaries into consecutive messages sent in order (the sandbox's one message per second is awaited). The agent's Hebrew-only rule already keeps identifiers out of the text; the channel context asks for brevity, and the shaper is the safety net.

### 7.5 Identity and safety

- Only numbers present in `messaging_contacts` get a session; everything else is stored as `ignored`.
- Every write the bot makes is attributed to the contact's person (`byId`) by the agent's existing rule; the transcript is the audit next to the database's own audit table.
- `reset_project` is denied by the allow-list; the shell and file tools are not available; the Supabase MCP is not available in v1.
- Secrets: `.env` on the laptop, function secrets in Supabase; nothing in the repository. Phone numbers exist only in the database.

### 7.6 Why print mode, and what it costs on a Max plan (decision 5)

"Headless" here means nothing more than Claude Code without its terminal screen: `claude -p` is the same program, agent, skills, tools and login, run once per message and resumed by session id. Something has to run Claude when a WhatsApp message arrives and nobody is at the laptop, and there are three ways to do it:

| | `claude -p` per turn (recommended) | A persistent interactive session with a *channel* plugin | Agent SDK or the Messages API |
| --- | --- | --- | --- |
| What it is | The daemon spawns `claude -p --agent shraga --resume …` for every turn | `claude --agent shraga --channels plugin:…` stays open in a terminal; a channel is an MCP server that pushes events into that session and exposes a `reply` tool | A Node process calls the model directly |
| Covered by the Max subscription | **Yes.** Print mode uses the `/login` credential like an interactive session; the docs single out `--bare` as the mode that "doesn't use your subscription login". For a process that runs where no browser login is possible, `claude setup-token` mints a one-year subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) | **Yes.** The docs say Pro and Max users have channels available and opt in per session | **No.** The Agent SDK and the API need `ANTHROPIC_API_KEY` and are billed per token |
| Status | Documented; flags verified on Claude Code 2.1.270 | Research preview: Telegram, Discord and iMessage plugins exist; a WhatsApp channel would be custom and needs `--dangerously-load-development-channels` during the preview; the flag syntax "may change" | Stable |
| Conversations | One per project (or per phone); ON/OFF is whether the daemon runs | One session for everything, alive only while the terminal is open | Whatever the code does |
| Questions and permissions | `AskUserQuestion` is removed by `--permission-prompts none`; the agent's numbered-list fallback applies; tools pre-approved by an allow-list | A permission prompt pauses the session until someone answers at the terminal, unless the channel relays prompts or permissions are bypassed | The SDK's `canUseTool` callback can relay questions and approvals into WhatsApp |
| Latency per turn | Process start plus the MCP server's compile, roughly 5–10 s before the agent's own work | None beyond the agent's work | None |

Recommendation: print mode under the Max login, with the channels route kept in view. Everything in the daemon except the session runner is the same in both, so a channel runner can be added later without touching the scheduler, the adapters or the inbox. Two zero-code experiments exist today if wanted: `claude --agent shraga --channels plugin:telegram@claude-plugins-official` gives the agent a Telegram bot in ten minutes (not WhatsApp, and the terminal must stay open), and the official fakechat plugin shows the channel flow on localhost.

What "covered" means in practice: a headless turn counts against the plan's usage limits like any Claude Code turn and is not billed per token; `total_cost_usd` in the JSON result is a client-side estimate, and `--max-budget-usd` is a runaway guard computed from it, never a bill. Three conditions keep it that way:

- The daemon's environment must not contain `ANTHROPIC_API_KEY`: in print mode "the key is always used when present", which would route every run to metered billing. The runner refuses to start with the variable set.
- The login must be valid. A subscription login expires and, per the docs, "a session that outlives the login stops making progress"; the runner recognises the expired-login result, stops spawning, and says so in the strip and the log. A launchd daemon should carry a `setup-token` token in its environment rather than depend on the interactive login.
- The runner must never pass `--bare`, which skips the login, the project's agent, skills and MCP servers. The docs say bare "will become the default for `-p` in a future release"; the runner pins its flags and the Claude Code version it was tested with, and adopts the opt-out when that change lands.

Quota, not money, is the cost to plan for: every pass and every chat turn shares the same rolling usage windows as the user's own sessions. The probe keeps quiet ticks free of any model call, a demo day is a few dozen turns, and the daemon's log prints each turn's estimated cost so the share stays visible.

## 8. Files and changes

### New

| Path | Purpose |
| --- | --- |
| `scripts/monitor.ts` | The daemon: `npm run monitor` (run), `-- once` (one tick for cron), `-- settings`, `-- status`, `-- contact add/list/remove`, `-- forget`; flags `--channel`, `--as`, `--project` |
| `src/hadarim/messaging/settings.ts` | `MonitorSettings` type, `STANDARD_MONITOR_SETTINGS`, read/write of `monitor_settings`, browser-safe (the strip uses it) |
| `src/hadarim/messaging/scheduler.ts` | Pure: `nextTick`, `Monitor` interface, the `documents` and `erp` monitors' `due`/`probe` |
| `src/hadarim/messaging/probe.ts` | The deterministic probe over `db/client.ts` reads |
| `src/hadarim/messaging/session-runner.ts` | The `claude -p` wrapper (7.2) |
| `src/hadarim/messaging/channel.ts`, `console.ts`, `vonage.ts` | The adapter interface and two adapters |
| `src/hadarim/messaging/inbox.ts` | Claim/close inbox rows, contacts, outbound rows, the monthly counter, the window rule |
| `src/hadarim/messaging/shape.ts` | Text shaping for WhatsApp (7.4) |
| `src/hadarim/messaging/relay.ts` | Inbound turn → session → outbound; the per-contact queue; the runner-side commands |
| `supabase/functions/messaging-inbound/index.ts`, `supabase/functions/_shared/vonage.ts` | The webhook and its pure parsing/verification |
| `supabase/migrations/2026MMDD…_monitor_and_messaging.sql` | `monitor_settings`, `messaging_contacts`, `conversations`, `messages`, policies, grants, Realtime |
| `src/hadarim/features/erp/MonitorSwitch.tsx` (+ a few CSS rules) | The presenter-strip control (phase 1, decided) |
| `tests/hadarim.monitor.test.ts`, `tests/hadarim.messaging.test.ts`, `tests/fixtures/fake-claude.sh`, `tests/fixtures/vonage/*.json` | Tests (§9) |
| `.env.example`, `scripts/com.nadlan.monitor.plist` (launchd, optional) | Configuration |

### Touched (each a small, additive edit)

| Path | Change |
| --- | --- |
| `package.json` | Scripts `monitor`; dependency `@vonage/messages` (phase 2); `uuid` is not needed (`crypto.randomUUID`) |
| `src/hadarim/db/types.ts` | Regenerated after the migration |
| `src/hadarim/App.tsx` (the presenter strip) | Mount `MonitorSwitch` in the strip (one line; phase 1) |
| `scripts/heartbeat.sh` | Add `--allowedTools "mcp__bakara__*" Read Skill --permission-prompts none` so the one-shot run is not denied its tools (the latent gap of §1.7) |
| `.claude/agents/shraga.md`, `.claude/skills/bakara-heartbeat/SKILL.md` | Phase 4 only: the two settings tools in the list and one sentence in the skill |
| `src/hadarim/tools/index.ts` | Phase 4 only: `get_monitor_settings`, `set_monitor_settings` |
| `CLAUDE.md`, `docs/system-overview.md`, `docs/hadarim-v2-plan.md` | Running the monitor and the bot; the §9 heartbeat section gains "where it is scheduled"; a status entry |

### Untouched

`engine/*`, `checks`, `report`, `forecast`, `commands`, `operations`, `db/client.ts`, `db/session.ts`, the ERP screens, `report.html`, `reset_project()`, the seed and the generator, every existing test.

## 9. Testing

Offline (`npm test`, the default suite):

- **Scheduler**: fake timers; disabled → no timer; enabled → a tick after `interval_seconds`; interval change reschedules; OFF cancels; a busy project skips; backoff after two failures; per-monitor overrides pick the right cadence.
- **Probe**: on the generator package with the scenario fixture — quiet above the watermark, work after an ERP edit or an unprocessed document (reusing the patterns of `tests/hadarim.heartbeat.test.ts`).
- **Invisibility**: no file outside `src/hadarim/messaging/`, `scripts/monitor.ts` and the strip control imports `messaging/`; the existing suites pass unchanged.
- **Session runner**: `CLAUDE_BIN` points at `tests/fixtures/fake-claude.sh`, which asserts the flags it received and prints a canned `--output-format json` result; first turn creates and stores the id, later turns resume it, a non-zero exit becomes `failed`.
- **Vonage parsing and verification**: recorded inbound payloads and a JWT signed with a test secret; a wrong secret or a wrong `payload_hash` is rejected; the normalised shape is stable.
- **Shaping**: markdown to WhatsApp text, splitting at 3,500 characters on paragraph boundaries, Hebrew untouched.
- **Relay**: per-contact ordering and joining of queued messages; the window rule (`held_window_closed`, then sent on the next inbound); the monthly cap; unknown sender ignored.

Opt-in (`RUN_DB_TESTS=1`): the inbox round trip against the shared database (insert an inbound row → the relay claims and closes it), then reset the messaging tables it created.

Rehearsal, no WhatsApp and no message budget: `npm run monitor -- --channel console --as EYAL` with the heartbeat enabled at 20 seconds; upload a document in the ERP and watch the console get the card; answer "1"; check the ERP's change log and `list_heartbeats`.

## 10. Phases

| Phase | Delivers | Acceptance | Size |
| --- | --- | --- | --- |
| **0. Runner and console bot** (no schema, no channel) | `session-runner.ts`, `shape.ts`, `relay.ts` with the console adapter, `npm run monitor -- --channel console --as EYAL`; the allow-list fix in `heartbeat.sh` | A terminal conversation with the bakara agent as אייל: a question answered, a card walked with numbered options, a decision applied and verified; session resumes across turns; fake-claude tests pass | S–M |
| **1. Heartbeat schedule** | Migration (`monitor_settings`, contacts, messages), `scheduler.ts`, `probe.ts`, the daemon loop, `settings`/`status` CLI, the presenter-strip switch, the `heartbeat.sh` note | With the row disabled: no timer (test) and the ERP unchanged. Enabled at 20 s on the console channel: an ERP edit produces a pass and a card within one interval; a quiet minute produces no process; the strip shows the last tick | M |
| **2. WhatsApp** | `vonage.ts`, the Edge Function, contacts CLI (the two phones enrolled with `--notify`), the inbox consumer, the monthly cap and the window rule, `.env.example` | A message from either enrolled phone gets the agent's answer on both; an unknown phone is ignored; the signature check rejects a forged webhook; the counter refuses past the cap | M |
| **3. Alerts over WhatsApp** | §5.2 wired: the pass in the contact session, held messages when the window is closed, the quiet one-liner, the report link | The demo loop: upload a document or edit an invoice in the ERP → within the interval the phone shows the card → reply "1" → the ERP record is corrected and logged, the verification line arrives, the heartbeat is recorded | S–M |
| **4. Control from the bot and docs** | `get_monitor_settings` / `set_monitor_settings` tools, agent list and skill sentence, `CLAUDE.md` and overview updates, the launchd plist | "הפעל פעימת לב כל דקה" over WhatsApp changes the row; docs describe running and switching it off | S |
| **5. Later** | Routing by the card's people; `ask_person` sends over the channel and the reply lands in `answer_question`; inbound media → `add_document`; the Word report as a WhatsApp file (public `exports` bucket); delivery/read status; reminders for unanswered cards; Realtime wake instead of a pure interval; the Agent SDK runner with interactive WhatsApp lists (needs an API key) | — | — |

Sizes: S about half a day, M one to two days. Phases 0 and 1 need no Vonage account and give the whole loop on the console; phase 2 is the first external dependency.

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Sandbox fair-use cap (100/month) exhausted before the demo | Console rehearsals; the outbound counter with a hard cap; Twilio adapter as the same-day fallback |
| The 24-hour window is closed when the heartbeat wants to alert | Held messages released on the next inbound; the presenter opens the window before the demo; Meta template is the production answer |
| A pass is slow (MCP server compile + a headless run) and the demo waits | Short interval with a cheap probe so the pass starts right after the change; a pre-bundled MCP server later; the "רגע, בודק…" line as a setting |
| A denied tool in headless mode stalls a pass silently | Explicit allow-list per run; a test with the fake CLI asserts the flags; the log shows denials |
| Two open questions in one conversation | The per-contact queue: alerts wait behind an unanswered question |
| A demo reset erases settings or contacts | Neither table is touched by `reset_project()`; the settings are outside the seed by design |
| Secrets or phone numbers leak into the public repository | `.env` ignored, function secrets in Supabase, contacts only in the database, a test that no `.env` is tracked |
| Unattended writes to the ERP | Every write is a decision the person took in the conversation, attributed and logged; reset, shell and SQL are unavailable to the bot |
| Realtime drops and the inbox stalls | The 10-second safety poll while a channel is on; re-scan of `received` rows on start |
| `ANTHROPIC_API_KEY` in the daemon's environment routes runs to metered billing instead of the subscription | The runner refuses to start while the variable is set; the status line names the credential in use |
| The subscription login expires while the daemon runs unattended | The runner recognises the expired-login result, stops spawning and shows it in the strip and the log; a `setup-token` token in the environment for always-on use |
| `--bare` becomes the default for `-p` and drops the login, the agent and the MCP servers | Flags pinned and the tested Claude Code version recorded; the fake-CLI test asserts the flags; adopt the opt-out when it lands |

## 12. Decisions

Taken by the user on 2026-09-14:

- **1 · Channel: Vonage** (the sandbox for the demo).
- **2 · Settings in their own row** (`monitor_settings`), not on the project row.
- **3 · The bot may do everything the laptop agent may, minus reset, the shell and SQL.**
- **4 · Two WhatsApp numbers are notified.** Both are enrolled at setup time with the CLI, each against a person of the project and flagged `notify`; the numbers live only in `messaging_contacts` on the shared database, never in the repository. Consequences: one conversation per project shared by both phones, mirrored to both, with sender-prefixed inbound so a decision is attributed to whoever took it (§5.2, §7.3); the Vonage sandbox accepts several allow-listed phones under one API key (a phone can be allow-listed against one API key at a time).
- **6 · The presenter-strip switch is wanted in phase 1.**

- **5 · Run under the subscription.** Print mode under the Max login, no API key, with the three conditions of §7.6 (no `ANTHROPIC_API_KEY` in the daemon's environment, a valid login or a `setup-token` token, never `--bare`) and `--max-budget-usd` as a runaway guard. The channels route stays available as a later runner.

## 13. Status

**Phase 0 done (2026-09-14).** Built: `src/hadarim/messaging/` (`channel.ts`, `shape.ts`, `session-runner.ts`, `context.ts`, `conversations.ts`, `relay.ts`, `console.ts`, `people.ts`), `scripts/monitor.ts` (`npm run monitor -- --channel console --as EYAL`, `status`, `forget`), `tests/hadarim.monitor.test.ts` with `tests/fixtures/fake-claude.mjs` (22 tests: the pinned flags, new and resumed turns, failure, expired login and timeout, the shaper, the relay's queueing and mirroring and commands, the console channel, the file store, the invisibility rule), the allow-list fix in `scripts/heartbeat.sh`, `.env.example`. Differences from the sketch: the conversation store is a JSON file under `out/monitor/` until phase 1 puts it in the `conversations` table; the runner strips the enclosing Claude Code session's variables from the child's environment so the monitor also works when started from inside a session; "a question is waiting" is detected from the reply's last paragraph (a line ending in a question mark, or numbered options), since the agent writes the question above the options.

Verified live on the console channel, under the subscription, no API key: a first turn opened a session with the channel context (31 s, the forecast and the variance with their sources); a second turn resumed it and answered "who approved" knowing it was talking to אייל (18 s); a third asked about the pending document and came back with a description, what does not fit, and three numbered options without writing anything (73 s). Nothing in the application changed: the existing suites pass unchanged and the invisibility test holds. Not exercised live: applying a decision through a card (the shared database's control had no undecided finding to walk without staging one); the path is covered by the relay tests and is the same `decide_finding` call the terminal makes.

**Phase 1 done (2026-09-14).** Built: migration `20260914120000_monitor_and_messaging.sql` (`monitor_settings`, `messaging_contacts`, `conversations`, `messages`; permissive policies and grants like the rest of the prototype; `monitor_settings` and `messages` in the Realtime publication; the security advisor is clean); `messaging/scheduler.ts` (pure: per-monitor intervals with a 15-second floor, due and next-delay computation, the `Scheduler` timer chain with the overlap guard, `wake()`, backoff after two failed passes, deferral when a question is waiting), `messaging/probe.ts` (the `erp` and `documents` monitors over injected reads; `dbProbeReads` wires the database), `messaging/settings.ts` (browser-safe read/write/subscribe of the row, the tick stamp, `daemonAlive`, `settingsChangeKey`), `messaging/conversations-db.ts` (the store in the `conversations` table), `messaging/prompts.ts` (the pass's prompt in a conversation, and alone), the relay's system turns (`enqueueSystem` resolves with whether a question is pending and whether the reply was delivered; a quiet pass is kept back when `notify_on_quiet` is off), `scripts/monitor.ts` as the daemon (`run` with or without the console channel, `once [--force]` for cron, `settings`, `status`, `forget`; woken by Realtime on a settings change, ignoring its own tick stamp), `features/erp/MonitorSwitch.tsx` on the presenter strip (on/off, the interval, "המנטר · פועל · בדיקה לפני N שניות" from the tick stamp, rendered only with the database online; the invisibility test allows this one file), 13 more tests (35 in the file: fake-timer scheduler, probes, prompts, settings mapping and liveness, the relay's system turns). Differences from the sketch: the tick stamp lives on the settings row (`last_tick_at`, `last_tick_found_work`), so the daemon filters its own Realtime echo by a change key; the contacts CLI stays in phase 2 (the console participant is in memory); a deferred pass is not a failure and does not count towards backoff.

Verified live under the subscription, at a 20-second interval on the console channel, with invoice 1148 moved to a wrong section through the CLI as the planted error: the first tick (three reads, no model) saw one change above the last heartbeat's watermark, the pass ran in the project's conversation (40 s, 4 agent turns) and presented the allocation card — problem, sources, meaning, the people involved, four numbered options with their consequences — and stopped at the question; the next ticks probed every 20 seconds and deferred the pass because a question was waiting, with no process spawned. The answer "1", typed on the console, resumed the same session: the agent checked the permission, corrected the invoice through `decide_finding`, quoted the re-read verification and the audit line, and recorded heartbeat 18 with the watermark the work tool had returned (34 s, 3 agent turns) — the decision path phase 0 could not exercise. The correction's own change-log row was above that watermark, so the following tick ran one more pass over the corrected record, as §5.2 anticipated: it found the record consistent with its contract, recorded heartbeat 19 and sent the one-line summary (`notify_on_quiet`); the seven ticks after it, at 20 seconds each, found nothing and spawned nothing. The strip and `status` show the tick stamp. Left as found: the heartbeat switched off, invoice 1148 on its correct section.

**Phase 2 done (2026-09-14), pending the Vonage account.** Built: `supabase/functions/_shared/vonage.ts` (pure, Web Crypto only: parse an inbound text or media message and a status update, verify a signed webhook — HS256 over the signature secret, `payload_hash` against the raw body, `iat` within ten minutes — and `signWebhook` for the tests and a simulator), `supabase/functions/messaging-inbound/index.ts` (the Edge Function: rejects unsigned and forged webhooks, inserts the inbox row with the service role, answers a retried message as a duplicate, updates an outbound row's status; **deployed** with `--no-verify-jwt`, secret `VONAGE_SIGNATURE_SECRET` set to a placeholder to be replaced by the account's), `messaging/inbox.ts` (contacts, inbox claim and close, outbound rows, the monthly count, held messages, the Realtime subscription, `insertInbound` for the simulator), `messaging/vonage.ts` (the adapter: application JWT — RS256 with the application's private key, the documented sandbox auth — or basic auth; `decideSend` — the monthly cap first, then the 24-hour window; held messages released on the person's next message; the inbox consumer that ignores unenrolled phones and stamps the contact's window), `scripts/monitor.ts` (`--channel vonage`, `contact add | list | remove`, `inbox simulate`, the WhatsApp lines of `status`), `.env.example` with the Vonage variables, 7 more tests (42 in the file). Differences from the sketch: plain `fetch` instead of the Vonage SDK (one POST; the application JWT is twenty lines of `node:crypto`); `Address.channel` is the medium (`whatsapp`) while the adapter is `vonage`, so a phone enrolled once serves any adapter; an inbox row is closed as done when it is handed to the relay (a crash mid-turn loses that turn, the text stays in the row); the webhook's field names come from the Messages API v1 as known, the raw payload is stored with every row, and the reference pages could not be fetched — check the first real message against them.

Verified live: the deployed function accepted a signed webhook (200, the row appeared in `messages`), rejected a forged signature and an unsigned request (401), and reported a retry of the same message as a duplicate (200). The two phones are enrolled (only in the database) and notified. With placeholder credentials and a simulated inbound from אייל's phone, the daemon on the WhatsApp channel ignored the webhook's test row from an unenrolled number, claimed the simulated one, resumed the project's conversation (21 s), tried to send the reply to אייל's phone (Vonage answered 401 Invalid Token, recorded as failed) and held the mirrored copy for רועי's phone because his 24-hour window is closed — every step short of the provider accepting the message.

To go live (the user's part, nothing in the repository): create a Vonage account; in the dashboard's Messages API Sandbox, allow-list both phones (each scans the QR or sends the join message); set the sandbox's inbound and status webhook URLs to `https://aevdlzncwkdosbzkgpgy.supabase.co/functions/v1/messaging-inbound`; copy the account's signature secret into the function (`supabase secrets set VONAGE_SIGNATURE_SECRET=… --project-ref aevdlzncwkdosbzkgpgy`); create an application with the Messages capability, download its private key outside the repository, and put `VONAGE_APPLICATION_ID`, `VONAGE_PRIVATE_KEY_PATH` and `VONAGE_WHATSAPP_FROM` (the sandbox number) in `.env`; then `npm run monitor -- --channel vonage`, send "היי" from a phone to the sandbox number (it opens the 24-hour window) and ask something. If the sandbox turns out to post unsigned webhooks, set `MESSAGING_ALLOW_UNSIGNED=1` on the function; if it rejects the application JWT, the API key and secret in `.env` switch the adapter to basic auth.

**Phase 3 done (2026-09-14), pending the Vonage account.** Most of it already existed after phases 1 and 2 (the pass in the shared conversation, held messages, the quiet one-liner); built now: the report link — the channel context tells the agent where the live report is (`MONITOR_REPORT_URL`, default this deployment's `report.html` on GitHub Pages; the agent sends the link with the summary line and never a file path) — and the conversation's `context_key` (migration `20260914150000`): a conversation remembers the context its Claude session was created with, and the relay starts a new one when the context differs (other participants, another link, a changed prompt), since Claude Code snapshots the system prompt per session. One more test (44 in the file).

Verified live, under the subscription: on the console, "שלח לי את הדוח" opened a new conversation (the context now carries the link), the agent ran the report skill and answered with the link, the executive summary and the decision needed, no file path (49 s, 9 agent turns). On the WhatsApp channel with placeholder credentials, the heartbeat at 20 seconds and invoice 1148 planted on a wrong section: the tick found the change, the pass presented the allocation card in a fresh WhatsApp-context conversation (32 s), the reply to אייל's phone was refused by Vonage (401, placeholder credentials) and recorded, the mirrored copy for רועי's phone was held (his window is closed); the ticks deferred while the question waited; a simulated "1" from אייל's phone resumed the session, the agent applied the fix through `decide_finding` with the re-read verification, the verification was mirrored to both phones (failed, held), the follow-up pass recorded heartbeat 22, and the quiet ticks spawned nothing. Every step of the demo loop short of Vonage accepting the messages. Housekeeping after the run: the heartbeat off, invoice 1148 on its correct section, the held test rows marked failed so nothing is released to רועי's phone by surprise when the channel goes live.

**Phase 4 done (2026-09-14).** Built: `get_monitor_settings` (read: the switch, the interval, the quiet flag, whether the monitor process is alive, the notified contacts with masked numbers, a Hebrew `sayHe`) and `set_monitor_settings` (write, on instruction: on/off, the interval with the 15-second floor, the quiet flag; refuses an empty change; its `messageHe` says when the monitor is not running, since the setting alone starts nothing) in the registry (56 tools), in the agent's list and table, in the `/bakara-heartbeat` skill and the MCP server's instructions; the invisibility test now allows the registry to import the settings, the scheduler's types and the contacts — and nothing else of the messaging layer; `scripts/com.nadlan.monitor.plist`, a launchd template (`sed` the two placeholders, `launchctl load`), with `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` in `.env` for a login that outlives the interactive one; `CLAUDE.md`, `system-overview.md` (§8 tools, §9 where it runs, §14) and this file. Two more tests (46 in the file, 194 in the suite).

Verified live: both tools from the shell (read; an interval change attributed to אייל; an empty change refused), and through the bot on the console — "הפעל בבקשה את פעימת הלב האוטומטית כל דקה" made the agent call the tool, the row switched on at 60 seconds, and the reply said in so many words that the monitor process was not running and the setting alone runs nothing (17 s). Left as found: the heartbeat off.

**Phase 5, two items done (2026-09-14):** the user chose the instant reaction and the received file.

- **Instant reaction.** `monitor_settings.wake_on_change` (migration `20260914160000`, default on): `messaging/wake.ts` subscribes to the project's change-log inserts and document events (Realtime, debounced 1.5 s) and the daemon calls `scheduler.wake({ force: true })`, which probes every monitor at once whether or not its interval elapsed; the interval stays as the ceiling. In the CLI (`settings --wake on|off`), the two agent tools (`wakeOnChange`) and the status line. While a long turn runs the scheduler is inside its tick, so wakes collapse into one re-tick after it — one turn at a time holds.
- **A photo or PDF as a document.** The Vonage adapter brings a received file to the document cache (`downloadInboundMedia`: a `file://` URL from the simulator is copied, Vonage's media URL is fetched with the same authorization as a send; the file's name from the sender, the URL or the kind) and hands the relay the message as `[קובץ התקבל: <path>] <caption>`; the channel context tells the agent to add the file to the folder (`add_document`), read it, record its facts and check the linked record in the same turn, without writing paths back. `inbox simulate --file` rehearses it without Vonage. Three more tests (47 in the file, 196 in the suite).

Verified live on the WhatsApp channel with placeholder credentials, the heartbeat on at a 300-second interval: a hand-built PDF invoice (a fictitious partial invoice of פלדות הצפון) sent as a file from אייל's phone — the daemon copied it to the cache, the agent added it to the folder, read it, recorded its facts and replied with what it read and three things that do not fit the system (the order it names is closed and fully billed, the framework agreement carries no retention, the price is the superseded appendix's) — and, correctly, keyed nothing in (140 s, 16 agent turns). The document's insert woke the probe within two seconds ("change in documents: probing now"); a planted ERP edit woke it again at once, well inside the 300-second interval, and the pass presented the allocation card; the answer "1" found the record already corrected, because the shared database had been reset by another session during the run, and said so. Every reply reached the send step (refused by Vonage with placeholder credentials, held for the closed window). Housekeeping: the heartbeat off, the held test rows marked failed. Not in the picture: Vonage's real media URL (the authorization it expects is assumed to be the send's; the first real photo will tell).

**Live on WhatsApp (2026-09-14).** The Vonage account was created by the user; the rest was done in the user's browser and shell: the account's API key and secret in the ignored `.env` (basic auth — the sandbox accepts it for sending, so no application key was needed), the sandbox number as the sender, the sandbox's inbound and status webhooks on the Edge Function, the function's signature secret set to the account's (the settings page did not accept a custom one; a signed test webhook came back 200), both phones paired with the sandbox's join phrase. First real exchanges: the join phrase itself was forwarded as a message and the agent answered it in good faith, so the relay now answers the pairing phrase with a greeting and spends no turn; a question from רועי's phone about the last report was answered in 20 seconds and mirrored to both phones; the status webhook marks the replies delivered and read. One failure: a question hung five minutes and failed because the Mac went to sleep mid-turn ("Connection lost while your computer was asleep" in the session's transcript) — the daemon runs under `caffeinate -i` from now on, the launchd template included. Twelve sandbox messages used of the month's hundred.

**The trace, and Sonnet at low effort (2026-09-14).** The runner now takes `--output-format stream-json` and hands every event to a trace (`messaging/trace.ts`): one line for the prompt it sent, one per tool call with its input, one per tool result (what the model reads next, cut at `MONITOR_TRACE_CHARS`, 600 by default), one per reply, and the turn's totals with the models used; `npm run monitor -- tail` follows the file (`out/monitor-trace.log`). The system prompt itself is not in the stream — it is the agent file, the skills and the channel context, all files. Headless turns default to `--model sonnet --effort low` (`MONITOR_MODEL`, `MONITOR_EFFORT`; an empty value leaves the agent file's model or the settings' effort); before this every headless turn ran on the user's default, Fable at xhigh, as the transcript showed. The agent file now declares `model: sonnet` and `effort: low`: a plain `claude -p --agent shraga` was verified to run on Sonnet, while the effort marker in its transcript stayed at the settings' xhigh, so the effort field does not reach a main-thread agent session on this Claude Code version and the runner's flag is what counts. The prompt is passed after `--`, since a variadic tool list would otherwise swallow it.

What remains: phase 5's later items (routing by the card's people, `ask_person` over the channel, the Word report as a file, reminders, the Agent SDK runner) and the demo rehearsal itself.
