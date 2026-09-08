import { addDays } from "./dates";
import type { ActivityEvent, AuditEvent, DemoState, EvidenceRef, ProposalRow } from "./types";

export const SYSTEM_ACTOR = "SYSTEM";

/** Deterministic sequential ids per prefix: PRP-0001, FND-0002 ... */
export function nextId(state: DemoState, prefix: string): [DemoState, string] {
  const n = (state.counters[prefix] ?? 0) + 1;
  const id = `${prefix}-${String(n).padStart(4, "0")}`;
  return [{ ...state, counters: { ...state.counters, [prefix]: n } }, id];
}

export function bump(state: DemoState): DemoState {
  return { ...state, revision: state.revision + 1 };
}

/** Advance the simulated clock by a few minutes so timelines read naturally. */
export function tick(state: DemoState, minutes = 2): DemoState {
  return { ...state, clock: addDays(state.clock, 0).replace(/T(\d{2}):(\d{2})/, (_m, h, mm) => {
    const total = Number(h) * 60 + Number(mm) + minutes;
    const hh = Math.min(23, Math.floor(total / 60));
    const m2 = total >= 24 * 60 ? 59 : total % 60;
    return `T${String(hh).padStart(2, "0")}:${String(m2).padStart(2, "0")}`;
  }) };
}

export function replaceById<T extends { id: string }>(items: T[], id: string, updater: (item: T) => T): T[] {
  let found = false;
  const next = items.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return updater(item);
  });
  if (!found) throw new Error(`replaceById: ${id} not found`);
  return next;
}

export function byId<T extends { id: string }>(items: T[], id: string, label = "item"): T {
  const item = items.find((x) => x.id === id);
  if (!item) throw new Error(`${label} ${id} not found`);
  return item;
}

export function actorInfo(state: DemoState, actorId: string): { nameHe: string; roleHe: string } {
  if (actorId === SYSTEM_ACTOR) return { nameHe: "בקרה", roleHe: "בדיקה אוטומטית" };
  const contact = state.contacts.find((c) => c.id === actorId);
  if (!contact) return { nameHe: actorId, roleHe: "" };
  return { nameHe: contact.nameHe, roleHe: contact.roleHe };
}

export interface AuditInput {
  actorId: string;
  kind: string;
  textHe: string;
  entityIds: string[];
  before?: ProposalRow[];
  after?: ProposalRow[];
  evidence?: EvidenceRef[];
  proposalId?: string;
  projectId?: string;
  costCodeId?: string;
  reportRelevant?: boolean;
}

export function addAudit(state: DemoState, input: AuditInput): [DemoState, AuditEvent] {
  const [s1, id] = nextId(state, "AUD");
  const actor = actorInfo(state, input.actorId);
  const event: AuditEvent = {
    id,
    at: state.clock,
    actorId: input.actorId,
    actorNameHe: actor.nameHe,
    actorRoleHe: actor.roleHe,
    kind: input.kind,
    textHe: input.textHe,
    entityIds: input.entityIds,
    before: input.before,
    after: input.after,
    evidence: input.evidence ?? [],
    proposalId: input.proposalId,
    projectId: input.projectId,
    costCodeId: input.costCodeId,
    reportRelevant: input.reportRelevant ?? false,
  };
  return [{ ...s1, auditEvents: [...s1.auditEvents, event] }, event];
}

export function addActivity(state: DemoState, kind: ActivityEvent["kind"], textHe: string, entityIds: string[] = []): DemoState {
  const [s1, id] = nextId(state, "ACT");
  const event: ActivityEvent = { id, at: state.clock, textHe, kind, entityIds };
  const activity = [...s1.activity, event].slice(-80);
  return { ...s1, activity };
}

export function evidenceLabel(state: DemoState, ref: EvidenceRef): string {
  const doc = state.documents.find((d) => d.id === ref.documentId);
  return ref.labelHe ?? doc?.titleHe ?? ref.documentId;
}

export function contactName(state: DemoState, contactId: string): string {
  return state.contacts.find((c) => c.id === contactId)?.nameHe ?? contactId;
}

export function projectName(state: DemoState, projectId: string): string {
  return state.projects.find((p) => p.id === projectId)?.nameHe ?? projectId;
}

export function costCodeName(state: DemoState, costCodeId: string): string {
  return state.costCodes.find((c) => c.id === costCodeId)?.nameHe ?? costCodeId;
}

export function supplierName(state: DemoState, supplierId: string | null): string {
  if (!supplierId) return "יתרת פתיחה";
  return state.suppliers.find((s) => s.id === supplierId)?.nameHe ?? supplierId;
}
