import { db, type Db } from "../db/client";
import type { Json, Tables } from "../db/types";
import type { Medium } from "./channel";

/**
 * The messaging tables (docs/heartbeat-bot-plan.md §6.3, §6.5): the enrolled contacts, the inbox the
 * webhook fills, the outbound rows the adapters write. Thin, typed access; the decisions (cap, window,
 * who is a participant) live in the adapters and the relay.
 */

export interface ContactRow {
  channel: Medium;
  address: string;
  projectId: string;
  personId: string;
  notify: boolean;
  lastInboundAt: string | null;
  displayName: string | null;
}

export interface MessageRow {
  id: number;
  channel: string;
  direction: "in" | "out";
  address: string;
  projectId: string | null;
  personId: string | null;
  provider: string | null;
  providerMessageId: string | null;
  text: string | null;
  media: Record<string, unknown> | null;
  status: string;
  sessionId: string | null;
  at: string;
}

function rowToContact(r: Tables<"messaging_contacts">): ContactRow {
  return { channel: r.channel as Medium, address: r.address, projectId: r.project_id, personId: r.person_id, notify: r.notify, lastInboundAt: r.last_inbound_at, displayName: r.display_name };
}

function rowToMessage(r: Tables<"messages">): MessageRow {
  return { id: r.id, channel: r.channel, direction: r.direction as "in" | "out", address: r.address, projectId: r.project_id, personId: r.person_id, provider: r.provider, providerMessageId: r.provider_message_id, text: r.text, media: (r.media as Record<string, unknown> | null) ?? null, status: r.status, sessionId: r.session_id, at: r.at };
}

/** The last four digits are enough to recognise a phone in a log or on a screen. */
export function maskAddress(address: string): string {
  return address.length > 4 ? `…${address.slice(-4)}` : address;
}

export async function listContacts(projectId: string, supabase: Db = db()): Promise<ContactRow[]> {
  const { data, error } = await supabase.from("messaging_contacts").select("*").eq("project_id", projectId).order("person_id");
  if (error) throw new Error(`messaging_contacts: ${error.message}`);
  return (data ?? []).map(rowToContact);
}

export async function findContact(channel: Medium, address: string, supabase: Db = db()): Promise<ContactRow | null> {
  const { data, error } = await supabase.from("messaging_contacts").select("*").eq("channel", channel).eq("address", address).maybeSingle();
  if (error) throw new Error(`messaging_contacts: ${error.message}`);
  return data ? rowToContact(data) : null;
}

export async function addContact(c: Omit<ContactRow, "lastInboundAt">, supabase: Db = db()): Promise<ContactRow> {
  const { data, error } = await supabase
    .from("messaging_contacts")
    .upsert({ channel: c.channel, address: c.address, project_id: c.projectId, person_id: c.personId, notify: c.notify, display_name: c.displayName }, { onConflict: "channel,address" })
    .select("*")
    .single();
  if (error) throw new Error(`messaging_contacts: ${error.message}`);
  return rowToContact(data);
}

export async function removeContact(channel: Medium, address: string, supabase: Db = db()): Promise<void> {
  const { error } = await supabase.from("messaging_contacts").delete().eq("channel", channel).eq("address", address);
  if (error) throw new Error(`messaging_contacts: ${error.message}`);
}

/** Stamp the contact's last inbound (the 24-hour window); false when the address is not enrolled. */
export async function touchContact(channel: Medium, address: string, at: string, supabase: Db = db()): Promise<boolean> {
  const { data, error } = await supabase.from("messaging_contacts").update({ last_inbound_at: at }).eq("channel", channel).eq("address", address).select("address");
  if (error) throw new Error(`messaging_contacts: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function listReceived(limit = 50, supabase: Db = db()): Promise<MessageRow[]> {
  const { data, error } = await supabase.from("messages").select("*").eq("direction", "in").eq("status", "received").order("id").limit(limit);
  if (error) throw new Error(`messages: ${error.message}`);
  return (data ?? []).map(rowToMessage);
}

/** Claim an inbox row (received → processing); false when another consumer got it first. */
export async function claimInbound(id: number, supabase: Db = db()): Promise<boolean> {
  const { data, error } = await supabase.from("messages").update({ status: "processing" }).eq("id", id).eq("status", "received").select("id");
  if (error) throw new Error(`messages: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function closeInbound(id: number, status: "done" | "failed" | "ignored", patch: { projectId?: string | null; personId?: string | null; sessionId?: string | null } = {}, supabase: Db = db()): Promise<void> {
  const { error } = await supabase.from("messages").update({ status, handled_at: new Date().toISOString(), ...(patch.projectId !== undefined ? { project_id: patch.projectId } : {}), ...(patch.personId !== undefined ? { person_id: patch.personId } : {}), ...(patch.sessionId !== undefined ? { session_id: patch.sessionId } : {}) }).eq("id", id);
  if (error) throw new Error(`messages: ${error.message}`);
}

export async function recordOutbound(m: { channel: Medium; address: string; projectId: string | null; personId: string | null; provider: string; providerMessageId: string | null; text: string; status: string; raw?: Json }, supabase: Db = db()): Promise<number> {
  const { data, error } = await supabase
    .from("messages")
    .insert({ channel: m.channel, direction: "out", address: m.address, project_id: m.projectId, person_id: m.personId, provider: m.provider, provider_message_id: m.providerMessageId, text: m.text, status: m.status, raw: m.raw ?? null })
    .select("id")
    .single();
  if (error) throw new Error(`messages: ${error.message}`);
  return data.id;
}

export async function updateOutbound(id: number, patch: { status?: string; providerMessageId?: string | null; raw?: Json }, supabase: Db = db()): Promise<void> {
  const { error } = await supabase.from("messages").update({ ...(patch.status ? { status: patch.status, handled_at: new Date().toISOString() } : {}), ...(patch.providerMessageId !== undefined ? { provider_message_id: patch.providerMessageId } : {}), ...(patch.raw !== undefined ? { raw: patch.raw } : {}) }).eq("id", id);
  if (error) throw new Error(`messages: ${error.message}`);
}

/** Outbound messages the provider accepted this calendar month (the sandbox's fair-use budget). */
export async function countSentThisMonth(provider: string, now = new Date(), supabase: Db = db()): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count, error } = await supabase.from("messages").select("id", { count: "exact", head: true }).eq("direction", "out").eq("provider", provider).not("status", "in", "(failed,held_window_closed)").gte("at", monthStart);
  if (error) throw new Error(`messages: ${error.message}`);
  return count ?? 0;
}

/** Outbound messages held because the 24-hour window was closed, oldest first. */
export async function listHeld(channel: Medium, address: string, supabase: Db = db()): Promise<MessageRow[]> {
  const { data, error } = await supabase.from("messages").select("*").eq("direction", "out").eq("channel", channel).eq("address", address).eq("status", "held_window_closed").order("id");
  if (error) throw new Error(`messages: ${error.message}`);
  return (data ?? []).map(rowToMessage);
}

/** Insert an inbound row as the webhook would — the simulator, and the tests of the consumer. */
export async function insertInbound(m: { channel: Medium; address: string; text: string | null; provider?: string; providerMessageId?: string | null; media?: Record<string, unknown> | null; raw?: Json }, supabase: Db = db()): Promise<number> {
  const { data, error } = await supabase
    .from("messages")
    .insert({ channel: m.channel, direction: "in", address: m.address, provider: m.provider ?? "simulator", provider_message_id: m.providerMessageId ?? null, text: m.text, media: (m.media ?? null) as Json, status: "received", raw: m.raw ?? null })
    .select("id")
    .single();
  if (error) throw new Error(`messages: ${error.message}`);
  return data.id;
}

/** Wake on every inbound insert. Returns the unsubscribe. */
export function subscribeInbound(onInsert: () => void, supabase: Db = db()): () => void {
  const channel = supabase.channel("messaging-inbox");
  channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "direction=eq.in" }, () => onInsert());
  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
