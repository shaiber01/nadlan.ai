import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Channel, Inbound, Medium } from "./channel";
import { claimInbound, closeInbound, countSentThisMonth, insertInbound, listHeld, listReceived, maskAddress, recordOutbound, subscribeInbound, touchContact, updateOutbound, type MessageRow } from "./inbox";

/**
 * WhatsApp through the Vonage Messages API (docs/heartbeat-bot-plan.md §6.2, §6.4). Outbound: one POST
 * per message to the sandbox (or production) endpoint, recorded in `messages`; the two sandbox limits
 * are rules here — a monthly cap the adapter refuses to cross, and the 24-hour window: a message to a
 * person who has not written in the last 24 hours is held and released on their next message. Inbound:
 * the webhook (the Edge Function) fills the inbox; the adapter claims rows, stamps the contact's window
 * and hands the message to the relay. The adapter also runs the simulator's rows (provider "simulator").
 */

export const VONAGE_SANDBOX_URL = "https://messages-sandbox.nexmo.com/v1/messages";
export const DEFAULT_MONTHLY_CAP = 90;
export const WINDOW_HOURS = 24;

export interface VonageConfig {
  /** Basic auth (API key and secret) — used when no application key is configured. */
  apiKey?: string;
  apiSecret?: string;
  /** Application JWT (RS256 with the application's private key) — the documented way for the sandbox. */
  applicationId?: string;
  privateKeyPem?: string;
  /** The WhatsApp sender: the sandbox number, or the registered sender. */
  from: string;
  endpoint: string;
  monthlyCap: number;
  windowHours: number;
}

/** null when Vonage is not configured (no sender, or no credentials). */
export function vonageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VonageConfig | null {
  const from = env.VONAGE_WHATSAPP_FROM;
  const apiKey = env.VONAGE_API_KEY;
  const apiSecret = env.VONAGE_API_SECRET;
  const applicationId = env.VONAGE_APPLICATION_ID;
  const keyPath = env.VONAGE_PRIVATE_KEY_PATH;
  const privateKeyPem = env.VONAGE_PRIVATE_KEY ?? (keyPath ? readFileSync(keyPath, "utf8") : undefined);
  if (!from) return null;
  if (!(applicationId && privateKeyPem) && !(apiKey && apiSecret)) return null;
  return { apiKey, apiSecret, applicationId, privateKeyPem, from, endpoint: env.VONAGE_MESSAGES_URL || VONAGE_SANDBOX_URL, monthlyCap: env.MESSAGING_MONTHLY_CAP ? Number(env.MESSAGING_MONTHLY_CAP) : DEFAULT_MONTHLY_CAP, windowHours: WINDOW_HOURS };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** A Vonage application JWT: RS256, `application_id`, `iat`, `exp`, `jti`. */
export function applicationJwt(applicationId: string, privateKeyPem: string, nowMs = Date.now(), ttlSeconds = 900): string {
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ application_id: applicationId, iat, exp: iat + ttlSeconds, jti: randomUUID() }));
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), createPrivateKey(privateKeyPem)).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

export function authorizationHeader(cfg: VonageConfig, nowMs = Date.now()): string {
  if (cfg.applicationId && cfg.privateKeyPem) return `Bearer ${applicationJwt(cfg.applicationId, cfg.privateKeyPem, nowMs)}`;
  return `Basic ${Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64")}`;
}

export type SendDecision = { action: "send" } | { action: "hold"; reasonHe: string } | { action: "refuse"; reasonHe: string };

/** The two sandbox rules, pure: the monthly cap first, then the 24-hour window. */
export function decideSend(input: { nowMs: number; lastInboundAt: string | null; sentThisMonth: number; cap: number; windowHours: number }): SendDecision {
  if (input.sentThisMonth >= input.cap) return { action: "refuse", reasonHe: `מכסת ההודעות החודשית (${input.cap}) נוצלה` };
  const last = input.lastInboundAt ? Date.parse(input.lastInboundAt) : Number.NaN;
  if (!Number.isFinite(last) || input.nowMs - last > input.windowHours * 3_600_000) return { action: "hold", reasonHe: `חלון ${input.windowHours} השעות סגור — ההודעה תישלח כשהנמען יכתוב` };
  return { action: "send" };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** One text message through the Messages API; returns Vonage's message id. */
export async function sendWhatsAppText(cfg: VonageConfig, to: string, text: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, nowMs = Date.now()): Promise<{ messageUuid: string }> {
  const res = await fetchImpl(cfg.endpoint, {
    method: "POST",
    headers: { authorization: authorizationHeader(cfg, nowMs), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ to, from: cfg.from, channel: "whatsapp", message_type: "text", text }),
  });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`vonage ${res.status}: ${bodyText.slice(0, 300)}`);
  let id = "";
  try {
    id = String((JSON.parse(bodyText) as { message_uuid?: string }).message_uuid ?? "");
  } catch {
    /* an empty id is recorded as such */
  }
  return { messageUuid: id };
}

/** What the adapter needs from the inbox and the contacts; the database by default, fakes in the tests. */
export interface VonageInboxAccess {
  listReceived(): Promise<MessageRow[]>;
  claimInbound(id: number): Promise<boolean>;
  closeInbound(id: number, status: "done" | "failed" | "ignored", patch?: { projectId?: string | null; personId?: string | null }): Promise<void>;
  touchContact(channel: Medium, address: string, at: string): Promise<boolean>;
  lastInboundAt(channel: Medium, address: string): Promise<string | null>;
  countSentThisMonth(provider: string, now: Date): Promise<number>;
  recordOutbound(m: Parameters<typeof recordOutbound>[0]): Promise<number>;
  updateOutbound(id: number, patch: Parameters<typeof updateOutbound>[1]): Promise<void>;
  listHeld(channel: Medium, address: string): Promise<MessageRow[]>;
  subscribeInbound(onInsert: () => void): () => void;
}

export function dbInboxAccess(lastInboundAt: (channel: Medium, address: string) => Promise<string | null>): VonageInboxAccess {
  return {
    listReceived: () => listReceived(),
    claimInbound: (id) => claimInbound(id),
    closeInbound: (id, status, patch) => closeInbound(id, status, patch),
    touchContact: (channel, address, at) => touchContact(channel, address, at),
    lastInboundAt,
    countSentThisMonth: (provider, now) => countSentThisMonth(provider, now),
    recordOutbound: (m) => recordOutbound(m),
    updateOutbound: (id, patch) => updateOutbound(id, patch),
    listHeld: (channel, address) => listHeld(channel, address),
    subscribeInbound: (onInsert) => subscribeInbound(onInsert),
  };
}

export interface VonageChannelOptions {
  cfg: VonageConfig;
  projectId: string;
  inbox: VonageInboxAccess;
  /** The people we serve: an inbound from anyone else is closed as ignored without reaching the relay. */
  isEnrolled(address: string): boolean;
  personIdOf(address: string): string | null;
  log?: (line: string) => void;
  now?: () => number;
  fetchImpl?: FetchLike;
  pollMs?: number;
}

const MEDIUM: Medium = "whatsapp";

export function createVonageChannel(opts: VonageChannelOptions): Channel {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  let draining = false;
  let again = false;

  async function sendNow(to: string, text: string): Promise<string> {
    const { messageUuid } = await sendWhatsAppText(opts.cfg, to, text, opts.fetchImpl, now());
    return messageUuid;
  }

  async function releaseHeld(address: string): Promise<void> {
    for (const held of await opts.inbox.listHeld(MEDIUM, address)) {
      try {
        const id = await sendNow(address, held.text ?? "");
        await opts.inbox.updateOutbound(held.id, { status: "sent", providerMessageId: id || null });
        log(`released a held message to ${maskAddress(address)}`);
      } catch (e) {
        await opts.inbox.updateOutbound(held.id, { status: "failed" });
        log(`releasing a held message to ${maskAddress(address)} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  async function drain(onInbound: (m: Inbound) => void): Promise<void> {
    if (draining) {
      again = true;
      return;
    }
    draining = true;
    try {
      do {
        again = false;
        for (const row of await opts.inbox.listReceived()) {
          if (!(await opts.inbox.claimInbound(row.id))) continue;
          if (!opts.isEnrolled(row.address)) {
            await opts.inbox.closeInbound(row.id, "ignored");
            log(`ignored: inbound from ${maskAddress(row.address)} (not enrolled)`);
            continue;
          }
          await opts.inbox.touchContact(MEDIUM, row.address, row.at);
          await releaseHeld(row.address);
          const media = row.media as { kind?: string; name?: string; caption?: string } | null;
          const text = row.text ?? (media ? `[${media.kind ?? "קובץ"}${media.name ? ` ${media.name}` : ""}]` : "");
          await opts.inbox.closeInbound(row.id, "done", { projectId: opts.projectId, personId: opts.personIdOf(row.address) });
          onInbound({ id: String(row.id), from: { channel: MEDIUM, address: row.address }, text, at: row.at });
        }
      } while (again);
    } catch (e) {
      log(`inbox: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      draining = false;
    }
  }

  return {
    id: "vonage",
    async send(to, text) {
      const personId = opts.personIdOf(to.address);
      const decision = decideSend({ nowMs: now(), lastInboundAt: await opts.inbox.lastInboundAt(MEDIUM, to.address), sentThisMonth: await opts.inbox.countSentThisMonth("vonage", new Date(now())), cap: opts.cfg.monthlyCap, windowHours: opts.cfg.windowHours });
      if (decision.action === "refuse") {
        await opts.inbox.recordOutbound({ channel: MEDIUM, address: to.address, projectId: opts.projectId, personId, provider: "vonage", providerMessageId: null, text, status: "failed", raw: { error: decision.reasonHe } });
        log(`REFUSED a message to ${maskAddress(to.address)}: ${decision.reasonHe}`);
        throw new Error(decision.reasonHe);
      }
      if (decision.action === "hold") {
        const id = await opts.inbox.recordOutbound({ channel: MEDIUM, address: to.address, projectId: opts.projectId, personId, provider: "vonage", providerMessageId: null, text, status: "held_window_closed" });
        log(`held a message to ${maskAddress(to.address)}: ${decision.reasonHe}`);
        return { providerMessageId: `held:${id}` };
      }
      const rowId = await opts.inbox.recordOutbound({ channel: MEDIUM, address: to.address, projectId: opts.projectId, personId, provider: "vonage", providerMessageId: null, text, status: "sending" });
      try {
        const id = await sendNow(to.address, text);
        await opts.inbox.updateOutbound(rowId, { status: "sent", providerMessageId: id || null });
        return { providerMessageId: id };
      } catch (e) {
        await opts.inbox.updateOutbound(rowId, { status: "failed", raw: { error: e instanceof Error ? e.message : String(e) } });
        throw e;
      }
    },
    start(onInbound) {
      const kick = () => void drain(onInbound);
      const unsubscribe = opts.inbox.subscribeInbound(kick);
      const timer = setInterval(kick, opts.pollMs ?? 10_000);
      kick();
      return () => {
        clearInterval(timer);
        unsubscribe();
      };
    },
  };
}

/** The simulator: an inbound row as the webhook would insert it, for rehearsals without Vonage. */
export function simulateInbound(address: string, text: string): Promise<number> {
  return insertInbound({ channel: MEDIUM, address, text, provider: "simulator", providerMessageId: `sim-${randomUUID()}` });
}
