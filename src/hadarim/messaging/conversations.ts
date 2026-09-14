import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Where a conversation's Claude session lives (docs/heartbeat-bot-plan.md §7.3). Phase 0 keeps it in a
 * JSON file under `out/` (git-ignored); phase 1 moves it to the `conversations` table. One `project`
 * conversation per project is shared by the notified contacts; `contact` conversations come later.
 */

export type ConversationScope = "project" | "contact";

export interface Conversation {
  projectId: string;
  scope: ConversationScope;
  /** The contact's address for a `contact` conversation; null for the project's. */
  address: string | null;
  sessionId: string;
  startedAt: string;
  lastTurnAt: string | null;
  turns: number;
  /** The last reply ended with a question: a card is waiting for an answer. */
  pendingQuestion: boolean;
}

export interface ConversationStore {
  get(projectId: string, scope: ConversationScope, address: string | null): Promise<Conversation | null>;
  save(c: Conversation): Promise<void>;
  remove(projectId: string, scope: ConversationScope, address: string | null): Promise<void>;
  list(): Promise<Conversation[]>;
}

export function conversationKey(projectId: string, scope: ConversationScope, address: string | null): string {
  return `${projectId}/${scope}/${address ?? ""}`;
}

export class MemoryConversationStore implements ConversationStore {
  protected items = new Map<string, Conversation>();

  async get(projectId: string, scope: ConversationScope, address: string | null): Promise<Conversation | null> {
    return this.items.get(conversationKey(projectId, scope, address)) ?? null;
  }

  async save(c: Conversation): Promise<void> {
    this.items.set(conversationKey(c.projectId, c.scope, c.address), { ...c });
    this.persist();
  }

  async remove(projectId: string, scope: ConversationScope, address: string | null): Promise<void> {
    this.items.delete(conversationKey(projectId, scope, address));
    this.persist();
  }

  async list(): Promise<Conversation[]> {
    return [...this.items.values()];
  }

  protected persist(): void {
    /* memory only */
  }
}

/** The same store, kept in a JSON file so the monitor resumes the conversation after a restart. */
export class FileConversationStore extends MemoryConversationStore {
  constructor(private readonly path: string) {
    super();
    if (existsSync(path)) {
      try {
        const rows = JSON.parse(readFileSync(path, "utf8")) as Conversation[];
        for (const c of rows) this.items.set(conversationKey(c.projectId, c.scope, c.address), c);
      } catch {
        /* an unreadable file is an empty store; it is rewritten on the next save */
      }
    }
  }

  protected override persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify([...this.items.values()], null, 2), "utf8");
  }
}
