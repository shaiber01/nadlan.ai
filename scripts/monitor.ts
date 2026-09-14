/**
 * The monitor — the heartbeat's scheduler and the chat relay (docs/heartbeat-bot-plan.md). Optional:
 * nothing runs unless this script is started, and nothing in the application depends on it. Every agent
 * turn is one `claude -p --agent bakara` under the machine's Claude login; the monitor refuses to start
 * with ANTHROPIC_API_KEY in its environment (print mode would bill the API with it).
 *
 *   npm run monitor                                   # the daemon: while the project's settings say enabled, a tick every
 *                                                     #   interval_seconds — a cheap probe, and the agent's pass only when there is work;
 *                                                     #   with no channel the pass runs alone (decides nothing) and its summary goes to the log
 *   npm run monitor -- --channel console --as EYAL    # the same, plus a rehearsal conversation in this terminal: the pass presents
 *                                                     #   its cards here, and every typed line is a turn of the same conversation
 *   npm run monitor -- once [--force]                 # one tick, then exit (for cron); --force ignores a disabled setting
 *   npm run monitor -- settings [--on|--off] [--interval 60] [--quiet on|off] [--by EYAL]
 *   npm run monitor -- status                         # settings, last tick, conversations, the runner's settings
 *   npm run monitor -- forget                         # drop the project's conversation (the next turn starts a new one)
 *   Global: --project HADARIM
 *
 * Settings come from the environment (`.env` in the repository root is loaded when present; see .env.example):
 * CLAUDE_BIN, MONITOR_MODEL, MONITOR_MAX_BUDGET_USD, MONITOR_TURN_TIMEOUT_MS.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { DEFAULT_PROJECT_ID } from "../src/hadarim/db/config";
import type { Participant } from "../src/hadarim/messaging/channel";
import { createConsoleChannel } from "../src/hadarim/messaging/console";
import { DbConversationStore } from "../src/hadarim/messaging/conversations-db";
import { loadPeople } from "../src/hadarim/messaging/people";
import { allMonitors } from "../src/hadarim/messaging/probe";
import { heartbeatAlonePromptHe, heartbeatPromptHe } from "../src/hadarim/messaging/prompts";
import { Relay } from "../src/hadarim/messaging/relay";
import { Scheduler, type MonitorSettings, type PassOutcome, type ProbeResult } from "../src/hadarim/messaging/scheduler";
import { assertNoApiKey, runTurn, runnerOptionsFromEnv } from "../src/hadarim/messaging/session-runner";
import { daemonAlive, readMonitorSettings, recordMonitorTick, settingsChangeKey, subscribeMonitorSettings, writeMonitorSettings } from "../src/hadarim/messaging/settings";

if (existsSync(".env")) process.loadEnvFile(".env");

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    channel: { type: "string" },
    as: { type: "string" },
    project: { type: "string" },
    on: { type: "boolean" },
    off: { type: "boolean" },
    interval: { type: "string" },
    quiet: { type: "string" },
    by: { type: "string" },
    force: { type: "boolean" },
  },
});

const projectId = (opts.project as string | undefined) ?? DEFAULT_PROJECT_ID;
const command = positionals[0] ?? "run";
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (line: string) => console.error(`[${stamp()}] ${line}`);

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function settingsLineHe(s: MonitorSettings | null): string {
  if (!s) return "פעימת לב: לא הוגדרה (כבויה)";
  const alive = daemonAlive(s);
  return `פעימת לב: ${s.enabled ? `פועלת כל ${s.intervalSeconds} שניות` : "כבויה"}${s.notifyOnQuiet ? "" : " · בלי סיכום כשאין מה להחליט"} · המנטר ${alive ? "פועל" : "לא פועל"}${s.lastTickAt ? ` · בדיקה אחרונה ${new Date(s.lastTickAt).toLocaleTimeString("he-IL")}${s.lastTickFoundWork ? " (נמצאה עבודה)" : ""}` : ""}`;
}

async function main() {
  const store = new DbConversationStore();
  const runnerOptions = runnerOptionsFromEnv();

  if (command === "status") {
    const s = await readMonitorSettings(projectId);
    console.log(`project ${projectId} · ${settingsLineHe(s)}`);
    console.log(`runner: ${runnerOptions.bin} · agent ${runnerOptions.agent} · model ${runnerOptions.model ?? "(agent default)"} · budget ${runnerOptions.maxBudgetUsd == null ? "none" : `$${runnerOptions.maxBudgetUsd}`} · timeout ${runnerOptions.timeoutMs} ms`);
    console.log(`api key in environment: ${process.env.ANTHROPIC_API_KEY ? "YES — the monitor will refuse to run" : "no (the machine's Claude login is used)"}`);
    const rows = await store.list();
    if (!rows.length) console.log("conversations: none");
    for (const c of rows) console.log(`conversation ${c.projectId}/${c.scope}${c.address ? `/${c.address}` : ""}: session ${c.sessionId} · started ${c.startedAt} · ${c.turns} turns · last ${c.lastTurnAt ?? "—"}${c.pendingQuestion ? " · a question is waiting" : ""}`);
    return;
  }

  if (command === "settings") {
    const patch: Parameters<typeof writeMonitorSettings>[1] = {};
    if (opts.on) patch.enabled = true;
    if (opts.off) patch.enabled = false;
    if (opts.interval) patch.intervalSeconds = Number(opts.interval);
    if (opts.quiet === "on" || opts.quiet === "off") patch.notifyOnQuiet = opts.quiet === "on";
    const s = Object.keys(patch).length ? await writeMonitorSettings(projectId, patch, (opts.by as string | undefined) ?? null) : await readMonitorSettings(projectId);
    console.log(`${Object.keys(patch).length ? "✓ " : ""}project ${projectId} · ${settingsLineHe(s)}`);
    return;
  }

  if (command === "forget") {
    await store.remove(projectId, "project", null);
    console.log(`✓ conversation of ${projectId} forgotten; the next turn starts a new session`);
    return;
  }

  if (command !== "run" && command !== "once") fail("commands: run (default) · once · settings · status · forget");

  try {
    assertNoApiKey();
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }

  // the channel: a rehearsal conversation in this terminal, or none (the pass runs alone)
  const channelId = (opts.channel as string | undefined) ?? (opts.as ? "console" : "none");
  if (channelId !== "console" && channelId !== "none") fail(`channel ${channelId} is not built yet (phase 2); use --channel console or no channel`);
  let relay: Relay | null = null;
  let participants: Participant[] = [];
  if (channelId === "console") {
    const as = opts.as as string | undefined;
    if (!as) fail("--as <personId> is required for the console channel (see list_people / the ERP's people)");
    const people = await loadPeople(projectId);
    const person = people.find((p) => p.id === as);
    if (!person) fail(`person ${as} is not in project ${projectId}; people: ${people.map((p) => p.id).join(", ")}`);
    const channel = createConsoleChannel({ as: person.id, promptHe: person.nameHe });
    participants = [{ address: channel.address, personId: person.id, nameHe: person.nameHe, roleHe: person.roleHe, notify: true }];
    relay = new Relay({ projectId, participants, channel, store, runTurn: (input) => runTurn(input, runnerOptions), log });
  }

  const runPass = async (results: ProbeResult[]): Promise<PassOutcome> => {
    if (relay) {
      if (await relay.hasPendingQuestion()) return { ok: true, deferred: true };
      const s = await readMonitorSettings(projectId);
      const r = await relay.enqueueSystem(heartbeatPromptHe(participants, results), { deliverIfQuiet: s?.notifyOnQuiet ?? true });
      return { ok: r.ok, error: r.error };
    }
    const r = await runTurn({ sessionId: null, text: heartbeatAlonePromptHe(projectId) }, runnerOptions);
    if (r.ok) log(`pass alone ok · ${r.durationMs} ms · ${r.numTurns ?? "?"} agent turns · ≈ $${(r.costUsd ?? 0).toFixed(3)}\n${r.text}`);
    else log(`pass alone failed: ${r.error}${r.authExpired ? " (the login expired — run claude and log in again)" : ""}`);
    return { ok: r.ok, error: r.error };
  };

  const forced = command === "once" && !!opts.force;
  const scheduler = new Scheduler({
    projectId,
    readSettings: async () => {
      const s = await readMonitorSettings(projectId);
      return forced ? { ...(s ?? { projectId, enabled: false, intervalSeconds: 300, notifyOnQuiet: true, monitors: {}, lastTickAt: null, lastTickFoundWork: null, updatedBy: null, updatedAt: null }), enabled: true } : s;
    },
    monitors: allMonitors(),
    recordTick: (at, found) => recordMonitorTick(projectId, at, found),
    runPass,
    log,
  });

  if (command === "once") {
    const outcome = await scheduler.tick();
    console.log(outcome.skipped ? `tick skipped: ${outcome.skipped}` : outcome.work ? `tick: work found · pass ${outcome.pass?.deferred ? "deferred" : outcome.pass?.ok ? "ok" : `failed: ${outcome.pass?.error}`}` : "tick: nothing new");
    return;
  }

  const initial = await readMonitorSettings(projectId);
  console.log(`מוניטור · פרויקט ${projectId} · ${settingsLineHe(initial)}`);
  if (!initial?.enabled) console.log("להפעלה: המתג במסך המציג של מערכת המידע, או: npm run monitor -- settings --on --interval 60");
  if (relay) {
    const p = participants[0];
    const existing = await store.get(projectId, "project", null);
    console.log(`ערוץ מסוף · מדבר בשם ${p.nameHe} (${p.roleHe}) · ${existing ? `ממשיך שיחה קיימת (${existing.turns} תורות עד כה)` : "שיחה חדשה תיפתח בהודעה הראשונה"} · פקודות: /חדש · /סטטוס`);
    relay.start();
  } else {
    console.log("ללא ערוץ: פעימת לב שנמצא בה מה לעשות מוצגת כאן בלבד ולא מחליטה דבר (--channel console --as <id> לשיחה)");
  }
  console.log("Ctrl-C ליציאה");

  scheduler.start();
  // the daemon's own tick stamp also arrives here; only a change of the switch, the intervals or the quiet flag wakes it
  let seen = settingsChangeKey(initial);
  const unsubscribe = subscribeMonitorSettings(projectId, (s) => {
    const key = settingsChangeKey(s);
    if (key === seen) return;
    seen = key;
    log(`settings changed: ${s ? `${s.enabled ? "on" : "off"} · every ${s.intervalSeconds} s` : "no row"}`);
    scheduler.wake();
  });

  const shutdown = () => {
    scheduler.stop();
    unsubscribe();
    relay?.stop();
    console.log("\nלהתראות.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // piped console input (a rehearsal script): finish the queued turns, then leave
  if (relay) {
    process.stdin.on("end", () => {
      void relay.idle().then(shutdown);
    });
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
