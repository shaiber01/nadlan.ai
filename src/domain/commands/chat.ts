import { answerQuestion } from "../../intelligence/deterministic/chat";
import { bump, nextId } from "../state-utils";
import type { ChatScope, DemoState } from "../types";

/** Ask a supported question; answering never mutates the ledger or approves anything. */
export function askQuestion(state: DemoState, text: string, scopeOverride?: Partial<ChatScope>): DemoState {
  const trimmed = text.trim();
  if (!trimmed) return state;
  const scope: ChatScope = { ...state.chat.scope, ...scopeOverride };
  const { answer, parsed } = answerQuestion(state, trimmed, scope, state.chat.lastContext);
  const [s1, userId] = nextId(state, "CHAT");
  const [s2, botId] = nextId(s1, "CHAT");
  const lastContext = { projectId: parsed.portfolio ? state.chat.lastContext.projectId : (parsed.projectId ?? state.chat.lastContext.projectId), costCodeId: parsed.costCodeId ?? (parsed.category ? null : state.chat.lastContext.costCodeId) };
  return bump({
    ...s2,
    chat: {
      ...s2.chat,
      scope,
      lastContext,
      messages: [...s2.chat.messages, { id: userId, role: "user", textHe: trimmed, at: state.clock, scope }, { id: botId, role: "assistant", textHe: answer.headlineHe, at: state.clock, answer, scope }],
    },
  });
}

export function setChatScope(state: DemoState, scope: Partial<ChatScope>): DemoState {
  return { ...state, chat: { ...state.chat, scope: { ...state.chat.scope, ...scope } } };
}

export function clearChat(state: DemoState): DemoState {
  return { ...state, chat: { ...state.chat, messages: [] } };
}
