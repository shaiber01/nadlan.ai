import { db, type Db } from "../db/client";
import type { Tables } from "../db/types";
import type { Conversation, ConversationScope, ConversationStore } from "./conversations";

/** The conversation store in the `conversations` table (docs/heartbeat-bot-plan.md §6.5). */
export class DbConversationStore implements ConversationStore {
  constructor(private readonly supabase: Db = db()) {}

  private query(projectId: string, scope: ConversationScope, address: string | null) {
    const q = this.supabase.from("conversations").select("*").eq("project_id", projectId).eq("scope", scope);
    return address == null ? q.is("address", null) : q.eq("address", address);
  }

  async get(projectId: string, scope: ConversationScope, address: string | null): Promise<Conversation | null> {
    const { data, error } = await this.query(projectId, scope, address).maybeSingle();
    if (error) throw new Error(`conversations: ${error.message}`);
    return data ? rowToConversation(data) : null;
  }

  async save(c: Conversation): Promise<void> {
    const { data: existing, error: readError } = await this.query(c.projectId, c.scope, c.address).maybeSingle();
    if (readError) throw new Error(`conversations: ${readError.message}`);
    const row = { project_id: c.projectId, scope: c.scope, address: c.address, session_id: c.sessionId, started_at: c.startedAt, last_turn_at: c.lastTurnAt, turns: c.turns, pending_question: c.pendingQuestion };
    const { error } = existing ? await this.supabase.from("conversations").update(row).eq("id", existing.id) : await this.supabase.from("conversations").insert(row);
    if (error) throw new Error(`conversations: ${error.message}`);
  }

  async remove(projectId: string, scope: ConversationScope, address: string | null): Promise<void> {
    const q = this.supabase.from("conversations").delete().eq("project_id", projectId).eq("scope", scope);
    const { error } = await (address == null ? q.is("address", null) : q.eq("address", address));
    if (error) throw new Error(`conversations: ${error.message}`);
  }

  async list(): Promise<Conversation[]> {
    const { data, error } = await this.supabase.from("conversations").select("*").order("id");
    if (error) throw new Error(`conversations: ${error.message}`);
    return (data ?? []).map(rowToConversation);
  }
}

function rowToConversation(r: Tables<"conversations">): Conversation {
  return { projectId: r.project_id, scope: r.scope as ConversationScope, address: r.address, sessionId: r.session_id, startedAt: r.started_at, lastTurnAt: r.last_turn_at, turns: r.turns, pendingQuestion: r.pending_question };
}
