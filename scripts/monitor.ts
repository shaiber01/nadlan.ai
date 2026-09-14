/**
 * The monitor — the heartbeat's scheduler and the chat relay (docs/heartbeat-bot-plan.md). Optional:
 * nothing runs unless this script is started, and nothing in the application depends on it.
 *
 * Phase 0 (this file): the console channel — a rehearsal conversation with the bakara agent in this
 * terminal, one `claude -p` per turn, resumed by session id, under the machine's Claude login. No API key:
 * the monitor refuses to start with ANTHROPIC_API_KEY in its environment (it would bill the API).
 *
 *   npm run monitor -- --channel console --as EYAL [--project HADARIM]
 *   npm run monitor -- status                         # the stored conversations and the runner's settings
 *   npm run monitor -- forget [--project HADARIM]     # drop the project's conversation (the next turn starts a new one)
 *
 * Settings come from the environment (`.env` in the repository root is loaded when present; see .env.example):
 * CLAUDE_BIN, MONITOR_MODEL, MONITOR_MAX_BUDGET_USD, MONITOR_TURN_TIMEOUT_MS.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { DEFAULT_PROJECT_ID } from "../src/hadarim/db/config";
import type { Participant } from "../src/hadarim/messaging/channel";
import { createConsoleChannel } from "../src/hadarim/messaging/console";
import { FileConversationStore } from "../src/hadarim/messaging/conversations";
import { loadPeople } from "../src/hadarim/messaging/people";
import { Relay } from "../src/hadarim/messaging/relay";
import { assertNoApiKey, runTurn, runnerOptionsFromEnv } from "../src/hadarim/messaging/session-runner";

const STATE_PATH = "out/monitor/conversations.json";

if (existsSync(".env")) process.loadEnvFile(".env");

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    channel: { type: "string" },
    as: { type: "string" },
    project: { type: "string" },
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

async function main() {
  const store = new FileConversationStore(STATE_PATH);

  if (command === "status") {
    const runner = runnerOptionsFromEnv();
    console.log(`runner: ${runner.bin} · agent ${runner.agent} · model ${runner.model ?? "(agent default)"} · budget ${runner.maxBudgetUsd == null ? "none" : `$${runner.maxBudgetUsd}`} · timeout ${runner.timeoutMs} ms`);
    console.log(`api key in environment: ${process.env.ANTHROPIC_API_KEY ? "YES — the monitor will refuse to run" : "no (the machine's Claude login is used)"}`);
    const rows = await store.list();
    if (!rows.length) console.log("conversations: none");
    for (const c of rows) console.log(`conversation ${c.projectId}/${c.scope}${c.address ? `/${c.address}` : ""}: session ${c.sessionId} · started ${c.startedAt} · ${c.turns} turns · last ${c.lastTurnAt ?? "—"}${c.pendingQuestion ? " · a question is waiting" : ""}`);
    return;
  }

  if (command === "forget") {
    await store.remove(projectId, "project", null);
    console.log(`✓ conversation of ${projectId} forgotten; the next turn starts a new session`);
    return;
  }

  if (command !== "run") fail("commands: run (default) · status · forget");

  try {
    assertNoApiKey();
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }

  const channelId = (opts.channel as string | undefined) ?? "console";
  if (channelId !== "console") fail(`channel ${channelId} is not built yet (phase 2); use --channel console`);
  const as = opts.as as string | undefined;
  if (!as) fail("--as <personId> is required for the console channel (see list_people / the ERP's people)");

  const people = await loadPeople(projectId);
  const person = people.find((p) => p.id === as);
  if (!person) fail(`person ${as} is not in project ${projectId}; people: ${people.map((p) => p.id).join(", ")}`);

  const channel = createConsoleChannel({ as: person.id, promptHe: person.nameHe });
  const participants: Participant[] = [{ address: channel.address, personId: person.id, nameHe: person.nameHe, roleHe: person.roleHe, notify: true }];
  const runnerOptions = runnerOptionsFromEnv();
  const relay = new Relay({ projectId, participants, channel, store, runTurn: (input) => runTurn(input, runnerOptions), log });

  const existing = await store.get(projectId, "project", null);
  console.log(`מוניטור · ערוץ מסוף · מדבר בשם ${person.nameHe} (${person.roleHe}) · פרויקט ${projectId}`);
  console.log(existing ? `ממשיך שיחה קיימת (${existing.turns} תורות עד כה); /חדש מתחיל שיחה חדשה` : "שיחה חדשה תיפתח בהודעה הראשונה");
  console.log(`כל תור הוא הרצה של ${runnerOptions.bin} תחת ההתחברות של המחשב · פקודות: /חדש · /סטטוס · Ctrl-C ליציאה`);
  relay.start();

  const shutdown = () => {
    relay.stop();
    console.log("\nלהתראות.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // piped input (a rehearsal script, a test): finish the queued turns, then leave
  process.stdin.on("end", () => {
    void relay.idle().then(shutdown);
  });
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
