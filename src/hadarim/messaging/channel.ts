/**
 * The messaging layer's channel contract (docs/heartbeat-bot-plan.md §6.4). A channel delivers text to
 * an address and hands inbound messages to the relay. The console channel is stdin/stdout for
 * rehearsals; WhatsApp comes through Vonage (phase 2). Nothing in the existing application imports
 * this folder: the monitor (`scripts/monitor.ts`) is the only consumer.
 */

/** The adapter that carries the messages. */
export type ChannelId = "console" | "vonage" | "twilio" | "telegram";

/** The medium an address belongs to (what `messaging_contacts.channel` stores); an adapter serves one or more. */
export type Medium = "console" | "whatsapp" | "sms" | "telegram";

export interface Address {
  channel: Medium;
  /** A phone in E.164 without "+", a chat id, or the person id on the console. */
  address: string;
}

export interface Inbound {
  id: string;
  from: Address;
  text: string;
  /** ISO timestamp of receipt. */
  at: string;
}

export interface Channel {
  id: ChannelId;
  /** Deliver one text message. Long texts are split by the relay before this is called. */
  send(to: Address, text: string): Promise<{ providerMessageId: string }>;
  /** Start receiving; `onInbound` is called for every message. Returns the stop function. */
  start(onInbound: (m: Inbound) => void): () => void;
}

/** Someone the conversation is with: an enrolled address bound to a person of the project. */
export interface Participant {
  address: Address;
  personId: string;
  nameHe: string;
  roleHe: string;
  /** Receives the heartbeat's cards and every mirrored reply. */
  notify: boolean;
}

export function addressKey(a: Address): string {
  return `${a.channel}:${a.address}`;
}

export function sameAddress(a: Address, b: Address): boolean {
  return a.channel === b.channel && a.address === b.address;
}
