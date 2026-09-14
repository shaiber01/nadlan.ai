import { addressKey, type Channel, type Inbound, type Participant } from "./channel";
import { channelContextHe, contextKeyOf } from "./context";
import type { Conversation, ConversationStore } from "./conversations";
import type { TurnInput, TurnResult } from "./session-runner";
import { DEFAULT_MAX_MESSAGE_CHARS, endsWithQuestion, shapeForChat, splitMessage } from "./shape";

/**
 * The relay: inbound message → the project's conversation → one turn of the agent → the reply, shaped
 * and mirrored to everyone in the conversation (docs/heartbeat-bot-plan.md §7.1, §7.3). One turn at a
 * time per conversation; messages that arrive during a turn are queued and joined into the next one,
 * each prefixed with its sender. A turn nobody sent (the heartbeat, phase 1) goes through the same
 * queue with `enqueueSystem`. Unknown senders are ignored. A few commands are the relay's own.
 */

export interface RelayOptions {
  projectId: string;
  participants: Participant[];
  channel: Channel;
  store: ConversationStore;
  runTurn: (input: TurnInput) => Promise<TurnResult>;
  /** Appended to the system prompt on the conversation's first turn (default: `channelContextHe`). */
  contextHe?: string;
  /** The live report's link, for the default context. */
  reportUrl?: string | null;
  log?: (line: string) => void;
  maxMessageChars?: number;
  now?: () => Date;
}

export interface SystemTurnOutcome {
  ok: boolean;
  error?: string;
  /** The reply waits for an answer (a card was presented). */
  pendingQuestion: boolean;
  /** The reply was sent to the participants (a quiet reply may be kept back). */
  delivered: boolean;
}

type QueueItem = { kind: "person"; m: Inbound; p: Participant } | { kind: "system"; text: string; deliverIfQuiet: boolean; resolve: (r: SystemTurnOutcome) => void };

export const RELAY_TEXT_HE = {
  newConversation: "התחלתי שיחה חדשה.",
  paired: "החיבור הצליח. אפשר לכתוב לי שאלה על הפרויקט (למשל: מה התחזית לגמר?), לשלוח צילום של חשבונית או הצעת מחיר, או לחכות להתראות שלי.",
  failed: "לא הצלחתי לסיים את הפעולה. נסה שוב בעוד רגע.",
  authExpired: "ההתחברות של המערכת פגה. צריך להתחבר מחדש במחשב, ואז לנסות שוב.",
  notConnected: "המערכת לא מחוברת כרגע. צריך להתחבר מחדש במחשב.",
  unknownCommand: "פקודות: /חדש לשיחה חדשה · /סטטוס למצב.",
};

const COMMANDS = {
  new: /^\/(חדש|new)\s*$/i,
  status: /^\/(סטטוס|status)\s*$/i,
};

/** The sandbox's pairing phrase ("Join two words"), which Vonage forwards like any message: answered here, never by the agent. */
export const PAIRING_PHRASE = /^join(\s+[a-z]+){1,3}\s*$/i;

export class Relay {
  private queue: QueueItem[] = [];
  private busy = false;
  private stopChannel: (() => void) | null = null;
  private idleWaiters: (() => void)[] = [];
  private byAddress = new Map<string, Participant>();
  /** The context this relay creates conversations with, and its key. */
  readonly contextHe: string;
  readonly contextKey: string;
  authExpired = false;
  lastError: string | null = null;
  turnsRun = 0;
  costUsd = 0;

  constructor(private readonly opts: RelayOptions) {
    for (const p of opts.participants) this.byAddress.set(addressKey(p.address), p);
    this.contextHe = opts.contextHe ?? channelContextHe(opts.participants, opts.channel.id, { reportUrl: opts.reportUrl });
    this.contextKey = contextKeyOf(this.contextHe);
  }

  start(): void {
    this.stopChannel = this.opts.channel.start((m) => this.enqueue(m));
  }

  stop(): void {
    this.stopChannel?.();
    this.stopChannel = null;
  }

  /** Resolves when the queue is empty and no turn is running. */
  idle(): Promise<void> {
    if (!this.busy && !this.queue.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  get status(): { busy: boolean; queued: number; authExpired: boolean; turnsRun: number; costUsd: number; lastError: string | null } {
    return { busy: this.busy, queued: this.queue.length, authExpired: this.authExpired, turnsRun: this.turnsRun, costUsd: this.costUsd, lastError: this.lastError };
  }

  enqueue(m: Inbound): void {
    const p = this.byAddress.get(addressKey(m.from));
    if (!p) {
      this.log(`ignored: message from unknown address ${addressKey(m.from)}`);
      return;
    }
    const text = m.text.trim();
    if (!text) return;
    if (text.startsWith("/")) {
      void this.command(text, p);
      return;
    }
    if (PAIRING_PHRASE.test(text)) {
      this.log(`pairing phrase from ${p.nameHe}: greeted, no turn`);
      void this.deliver([p], RELAY_TEXT_HE.paired);
      return;
    }
    this.queue.push({ kind: "person", m, p });
    void this.drain();
  }

  /**
   * A turn not sent by a person (the heartbeat's prompt); its reply goes to every notified participant.
   * With `deliverIfQuiet: false` a reply that asks nothing is kept back (logged, not sent). Resolves when
   * the turn ran.
   */
  enqueueSystem(text: string, opts: { deliverIfQuiet?: boolean } = {}): Promise<SystemTurnOutcome> {
    return new Promise((resolve) => {
      this.queue.push({ kind: "system", text, deliverIfQuiet: opts.deliverIfQuiet ?? true, resolve });
      void this.drain();
    });
  }

  /** Is a card waiting for an answer in the project's conversation? */
  async hasPendingQuestion(): Promise<boolean> {
    return (await this.conversation())?.pendingQuestion ?? false;
  }

  private async command(text: string, p: Participant): Promise<void> {
    if (COMMANDS.new.test(text)) {
      await this.opts.store.remove(this.opts.projectId, "project", null);
      this.authExpired = false;
      await this.deliver([p], RELAY_TEXT_HE.newConversation);
      return;
    }
    if (COMMANDS.status.test(text)) {
      const c = await this.conversation();
      const s = this.status;
      const line = [c ? `שיחה מ-${c.startedAt.slice(0, 16).replace("T", " ")} · ${c.turns} תורות` : "אין שיחה פתוחה", s.busy ? "עסוק" : "פנוי", s.queued ? `${s.queued} בתור` : "", s.authExpired ? "ההתחברות פגה" : "", s.turnsRun ? `${s.turnsRun} תורות בריצה זו (≈ $${s.costUsd.toFixed(2)})` : ""].filter(Boolean).join(" · ");
      await this.deliver([p], line);
      return;
    }
    await this.deliver([p], RELAY_TEXT_HE.unknownCommand);
  }

  private conversation(): Promise<Conversation | null> {
    return this.opts.store.get(this.opts.projectId, "project", null);
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0);
        await this.runBatch(batch);
      }
    } finally {
      this.busy = false;
      const waiters = this.idleWaiters.splice(0);
      for (const w of waiters) w();
    }
  }

  private recipients(batch: QueueItem[]): Participant[] {
    const out = new Map<string, Participant>();
    for (const p of this.opts.participants) if (p.notify) out.set(addressKey(p.address), p);
    for (const item of batch) if (item.kind === "person") out.set(addressKey(item.p.address), item.p);
    return [...out.values()];
  }

  private async runBatch(batch: QueueItem[]): Promise<void> {
    const systemItems = batch.filter((i): i is Extract<QueueItem, { kind: "system" }> => i.kind === "system");
    const settle = (r: SystemTurnOutcome) => {
      for (const item of systemItems) item.resolve(r);
    };
    const recipients = this.recipients(batch);
    if (this.authExpired) {
      await this.deliver(recipients, RELAY_TEXT_HE.notConnected);
      settle({ ok: false, error: "auth expired", pendingQuestion: false, delivered: false });
      return;
    }
    const text = batch.map((item) => (item.kind === "person" ? `${item.p.nameHe}: ${item.m.text.trim()}` : item.text)).join("\n");
    const stored = await this.conversation();
    // a session carries the context it was created with; a different one (other people, another report link) means a new conversation
    const existing = stored && stored.contextKey === this.contextKey ? stored : null;
    if (stored && !existing) this.log(`context changed (${stored.contextKey ?? "none"} → ${this.contextKey}): new conversation`);
    const input: TurnInput = existing ? { sessionId: existing.sessionId, text } : { sessionId: null, text, systemContext: this.contextHe };
    this.log(`turn → ${existing ? `resume ${existing.sessionId}` : "new session"} · ${text.length} chars`);
    const r = await this.opts.runTurn(input);
    this.turnsRun++;
    if (r.costUsd) this.costUsd += r.costUsd;
    const now = (this.opts.now ?? (() => new Date))().toISOString();
    if (!r.ok) {
      this.lastError = r.error ?? "unknown";
      this.log(`turn failed: ${this.lastError}`);
      if (r.authExpired) {
        this.authExpired = true;
        await this.deliver(recipients, RELAY_TEXT_HE.authExpired);
      } else {
        await this.deliver(recipients, RELAY_TEXT_HE.failed);
      }
      settle({ ok: false, error: this.lastError, pendingQuestion: false, delivered: true });
      return;
    }
    this.lastError = null;
    if (r.denials.length) this.log(`denied tools: ${r.denials.join(", ")}`);
    const reply = shapeForChat(r.text);
    const pendingQuestion = endsWithQuestion(reply);
    await this.opts.store.save({ projectId: this.opts.projectId, scope: "project", address: null, sessionId: r.sessionId, startedAt: existing?.startedAt ?? now, lastTurnAt: now, turns: (existing?.turns ?? 0) + 1, pendingQuestion, contextKey: this.contextKey });
    this.log(`turn ok · ${r.durationMs} ms · ${r.numTurns ?? "?"} agent turns · ≈ $${(r.costUsd ?? 0).toFixed(3)}`);
    // a heartbeat's quiet reply (nothing to decide) is kept back when the settings say so; a person's turn is always answered
    const quietSystemOnly = systemItems.length === batch.length && !pendingQuestion && systemItems.every((i) => !i.deliverIfQuiet);
    if (quietSystemOnly) this.log(`quiet pass, not delivered: ${reply.slice(0, 120).replace(/\n/g, " ")}`);
    else await this.deliver(recipients, reply || "…");
    settle({ ok: true, pendingQuestion, delivered: !quietSystemOnly });
  }

  private async deliver(to: Participant[], text: string): Promise<void> {
    const pieces = splitMessage(text, this.opts.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS);
    for (const p of to) {
      for (const piece of pieces) {
        try {
          await this.opts.channel.send(p.address, piece);
        } catch (e) {
          this.log(`send to ${addressKey(p.address)} failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  private log(line: string): void {
    this.opts.log?.(line);
  }
}
