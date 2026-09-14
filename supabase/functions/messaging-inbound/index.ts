// The messaging inbox's webhook (docs/heartbeat-bot-plan.md §6.3): Vonage posts every inbound WhatsApp
// message and every status update here. The function verifies the signed webhook, normalises the
// payload and writes it to `messages`; the monitor on the laptop consumes the rows. It answers 200 fast
// and never talks to the agent. Deploy with `--no-verify-jwt` (Vonage carries no Supabase token — the
// Vonage signature is the authentication).
//
// Secrets: VONAGE_SIGNATURE_SECRET (the account's signature secret; webhooks are rejected without it),
// MESSAGING_ALLOW_UNSIGNED=1 only if the sandbox turns out to send unsigned webhooks.
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseInbound, parseStatus, verifySignedWebhook } from "../_shared/vonage.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "GET") return json(200, { ok: true, service: "messaging-inbound" });
  if (req.method !== "POST") return json(405, { error: "method" });

  const raw = await req.text();
  const secret = Deno.env.get("VONAGE_SIGNATURE_SECRET") ?? "";
  const allowUnsigned = Deno.env.get("MESSAGING_ALLOW_UNSIGNED") === "1";
  const authorization = req.headers.get("authorization");
  if (secret && (authorization || !allowUnsigned)) {
    const v = await verifySignedWebhook(authorization, raw, secret);
    if (!v.ok) return json(401, { error: v.reason });
  } else if (!secret && !allowUnsigned) {
    return json(503, { error: "VONAGE_SIGNATURE_SECRET is not set" });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "not json" });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const inbound = parseInbound(body);
  if (inbound) {
    const { error } = await supabase.from("messages").insert({
      channel: inbound.channel,
      direction: "in",
      address: inbound.from,
      provider: inbound.provider,
      provider_message_id: inbound.providerMessageId,
      text: inbound.text,
      media: inbound.media,
      status: "received",
      raw: body,
      at: inbound.at,
    });
    // a retry of a message already stored is fine
    if (error && !/duplicate|unique/i.test(error.message)) return json(500, { error: error.message });
    return json(200, { ok: true, kind: "inbound", duplicate: !!error });
  }

  const status = parseStatus(body);
  if (status) {
    const { error } = await supabase.from("messages").update({ status: status.status, handled_at: status.at, ...(status.error ? { raw: body } : {}) }).eq("provider", "vonage").eq("provider_message_id", status.providerMessageId).eq("direction", "out");
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, kind: "status" });
  }

  return json(200, { ok: true, kind: "ignored" });
});
