/**
 * Vonage Messages API webhooks, the pure part (docs/heartbeat-bot-plan.md §6.3): parse an inbound
 * message or a status update, and verify a signed webhook. Web Crypto only, no Deno or Node globals,
 * so the Edge Function (Deno) and the tests (Node) share it. Field names follow the Messages API v1
 * (`message_uuid`, `to`, `from`, `timestamp`, `channel`, `message_type`, `text`, `profile.name`,
 * `image|file|audio|video.{url,caption,name}`; status: `status`, `error.{type,code,reason}`); the raw
 * payload is stored with every row, so a deviation shows up on the first real message.
 */

export interface InboundMedia {
  kind: string;
  url: string;
  caption: string | null;
  name: string | null;
}

export interface NormalizedInbound {
  provider: "vonage";
  providerMessageId: string;
  channel: string;
  from: string;
  to: string;
  text: string | null;
  media: InboundMedia | null;
  profileName: string | null;
  at: string;
}

export interface NormalizedStatus {
  providerMessageId: string;
  status: string;
  at: string;
  error: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);

const MEDIA_TYPES = ["image", "file", "audio", "video", "sticker"];

/** An inbound message, or null when the body is something else (a status update, a health check). */
export function parseInbound(body: unknown): NormalizedInbound | null {
  if (!isObj(body)) return null;
  const id = str(body.message_uuid);
  const from = str(body.from);
  const type = str(body.message_type);
  if (!id || !from || !type || str(body.status)) return null;
  let media: InboundMedia | null = null;
  if (MEDIA_TYPES.includes(type) && isObj(body[type])) {
    const m = body[type] as Obj;
    const url = str(m.url);
    if (url) media = { kind: type, url, caption: str(m.caption), name: str(m.name) };
  }
  const text = str(body.text) ?? media?.caption ?? null;
  const profile = isObj(body.profile) ? str(body.profile.name) : null;
  return { provider: "vonage", providerMessageId: id, channel: str(body.channel) ?? "whatsapp", from, to: str(body.to) ?? "", text, media, profileName: profile, at: str(body.timestamp) ?? new Date().toISOString() };
}

/** A message status update (submitted, delivered, read, rejected, undeliverable), or null. */
export function parseStatus(body: unknown): NormalizedStatus | null {
  if (!isObj(body)) return null;
  const id = str(body.message_uuid);
  const status = str(body.status);
  if (!id || !status) return null;
  const e = isObj(body.error) ? body.error : null;
  const error = e ? [str(e.type), str(e.code), str(e.reason)].filter(Boolean).join(" · ") || null : null;
  return { providerMessageId: id, status, at: str(body.timestamp) ?? new Date().toISOString(), error };
}

const enc = new TextEncoder();

function base64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Build a signed-webhook token the way Vonage does (HS256 over the signature secret) — for the tests and the simulator. */
export async function signWebhook(rawBody: string, secret: string, claims: Record<string, unknown> = {}, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = base64UrlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64UrlEncode(enc.encode(JSON.stringify({ iat: nowSeconds, jti: crypto.randomUUID(), payload_hash: await sha256Hex(rawBody), ...claims })));
  const sig = base64UrlEncode(await hmacSha256(secret, `${header}.${payload}`));
  return `${header}.${payload}.${sig}`;
}

export type Verification = { ok: true; claims: Record<string, unknown> } | { ok: false; reason: string };

/**
 * Verify `Authorization: Bearer <jwt>`: HS256 with the account's signature secret, `payload_hash` equal
 * to the SHA-256 of the raw body, `iat` within the tolerance (Vonage signs every retry afresh).
 */
export async function verifySignedWebhook(authorization: string | null, rawBody: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 600): Promise<Verification> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return { ok: false, reason: "no bearer token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const [h, p, s] = parts;
  let header: Obj;
  let claims: Obj;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(h))) as Obj;
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(p))) as Obj;
  } catch {
    return { ok: false, reason: "undecodable token" };
  }
  if (header.alg !== "HS256") return { ok: false, reason: `unexpected alg ${String(header.alg)}` };
  const expected = base64UrlEncode(await hmacSha256(secret, `${h}.${p}`));
  if (expected.length !== s.length) return { ok: false, reason: "bad signature" };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ s.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "bad signature" };
  if (typeof claims.payload_hash !== "string" || claims.payload_hash !== (await sha256Hex(rawBody))) return { ok: false, reason: "payload hash mismatch" };
  if (typeof claims.iat === "number" && Math.abs(nowSeconds - claims.iat) > toleranceSeconds) return { ok: false, reason: "token too old" };
  return { ok: true, claims };
}
