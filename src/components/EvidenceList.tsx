import { useUi } from "../app/ui";
import { useDemoState } from "../app/store";
import type { EvidenceRef } from "../domain/types";
import { Bidi } from "./primitives";

const kindHe: Record<string, string> = {
  budget: "תקציב",
  invoice: "חשבונית",
  delivery_note: "תעודת משלוח",
  purchase_order: "הזמנה",
  contract: "חוזה",
  plan: "תכנון",
  framework: "מסגרת",
  quote: "הצעת מחיר",
  certificate: "חשבון",
  addendum: "תוספת",
  credit: "זיכוי",
  change_order: "הוראת שינוי",
  schedule: "לוח זמנים",
  opening_balance: "יתרת פתיחה",
  forecast: "תחזית",
  commitment_balance: "התחייבות",
  reply: "תשובה",
  approval: "אישור ביצוע",
};

export function documentKindHe(kind: string): string {
  return kindHe[kind] ?? kind;
}

/** Clickable evidence references. Refs to messages/reports open their own surfaces; unknown refs are not rendered as fake sources. */
export function EvidenceList({ evidence, title = "מקורות" }: { evidence: EvidenceRef[]; title?: string | null }) {
  const state = useDemoState();
  const ui = useUi();
  const items = evidence
    .map((ref) => {
      const doc = state.documents.filter((d) => d.id === ref.documentId).sort((a, b) => b.version - a.version)[0];
      if (doc) {
        const anchor = ref.anchorId ? doc.anchors.find((a) => a.id === ref.anchorId) : undefined;
        return { ref, labelHe: ref.labelHe ?? doc.titleHe, kindHe: kindHe[doc.kind] ?? doc.kind, anchorHe: anchor?.labelHe, onClick: () => ui.openDocument(doc.id, ref.anchorId, ref.version) };
      }
      const report = state.reports.find((r) => r.id === ref.documentId);
      if (report) return { ref, labelHe: ref.labelHe ?? `דוח ${report.id}`, kindHe: "דוח", anchorHe: undefined, onClick: () => ui.openReport(report.id) };
      const conversation = state.conversations.find((c) => c.messages.some((m) => m.id === ref.documentId));
      if (conversation) return { ref, labelHe: ref.labelHe ?? "תשובת הלקוח", kindHe: conversation.channel === "whatsapp" ? "WhatsApp" : "מייל", anchorHe: undefined, onClick: () => ui.openConversation(conversation.id) };
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (items.length === 0) return null;
  return (
    <div className="stack-sm">
      {title ? <h4 className="muted">{title}</h4> : null}
      <div className="evidence-list">
        {items.map((item, i) => (
          <button key={`${item.ref.documentId}-${item.ref.anchorId ?? ""}-${i}`} type="button" className="evidence-link" onClick={item.onClick}>
            <span className="kind">{item.kindHe}</span>
            <Bidi>{item.labelHe}</Bidi>
            {item.anchorHe ? <span className="faint tiny">· {item.anchorHe}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
