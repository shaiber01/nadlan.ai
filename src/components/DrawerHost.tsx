import { useDemo } from "../app/store";
import { useUi, type DrawerSpec } from "../app/ui";
import { CalculationView } from "./CalculationView";
import { ConversationView } from "./ConversationView";
import { DocumentViewer } from "./DocumentViewer";
import { Surface } from "./Drawer";
import { FindingCard } from "./FindingCard";
import { HistoryList } from "./HistoryList";
import { PilotPanel } from "./PilotPanel";
import { ProposalCard } from "./ProposalCard";
import { RecordView } from "./RecordView";
import { ReportView } from "./ReportView";
import { RuleView } from "./RuleView";
import { Notice } from "./primitives";

function titleFor(spec: DrawerSpec, state: ReturnType<typeof useDemo>["state"]): { title: string; subtitle?: string; wide?: boolean; kind: "drawer" | "modal" } {
  switch (spec.kind) {
    case "document": {
      const doc = state.documents.find((d) => d.id === spec.documentId);
      return { title: doc?.titleHe ?? spec.documentId, subtitle: "מסמך מקור — לא ניתן לעריכה", kind: "drawer" };
    }
    case "record": {
      const r = state.erpRecords.find((x) => x.id === spec.recordId);
      return { title: r?.descriptionHe ?? spec.recordId, subtitle: `רשומה בזיו — סביבת הדגמה · ${spec.recordId}`, kind: "drawer" };
    }
    case "finding":
      return { title: "בדיקה וממצא", kind: "drawer" };
    case "proposal":
      return { title: "הצעה לבדיקת צוות הבקרה", kind: "drawer" };
    case "report": {
      const r = state.reports.find((x) => x.id === spec.reportId);
      return { title: r ? `דוח בקרה — ${r.frozen.projectNameHe}` : spec.reportId, subtitle: "ערכים קפואים במועד הדוח", wide: true, kind: "drawer" };
    }
    case "rule":
      return { title: "הנחיה מאושרת", kind: "drawer" };
    case "history":
      return { title: "היסטוריה", subtitle: "כל שינוי נרשם; היסטוריה אינה נמחקת", kind: "drawer" };
    case "calculation":
      return { title: "השפעה על יתרת הפרויקט", subtitle: "חישוב הסיכון המותנה", kind: "drawer" };
    case "conversation": {
      const c = state.conversations.find((x) => x.id === spec.conversationId);
      return { title: c?.titleHe ?? "שיחה", subtitle: "ההודעה מוצגת בתוך ההדגמה בלבד", kind: "drawer" };
    }
    case "pilot":
      return { title: "רוצים לבדוק את זה על פרויקט שלכם?", kind: "modal" };
    case "workbook":
      return { title: "קובץ Excel", kind: "modal" };
  }
}

export function DrawerHost() {
  const ui = useUi();
  const { state } = useDemo();
  const spec = ui.stack[ui.stack.length - 1];
  if (!spec) return null;
  const meta = titleFor(spec, state);
  let body: React.ReactNode;
  switch (spec.kind) {
    case "document":
      body = <DocumentViewer documentId={spec.documentId} anchorId={spec.anchorId} version={spec.version} />;
      break;
    case "record":
      body = <RecordView recordId={spec.recordId} />;
      break;
    case "finding": {
      const f = state.findings.find((x) => x.id === spec.findingId);
      body = f ? <FindingCard finding={f} /> : <Notice tone="amber">הממצא אינו זמין.</Notice>;
      break;
    }
    case "proposal": {
      const p = state.proposals.find((x) => x.id === spec.proposalId);
      body = p ? <ProposalCard proposal={p} /> : <Notice tone="amber">ההצעה אינה זמינה.</Notice>;
      break;
    }
    case "report":
      body = <ReportView reportId={spec.reportId} />;
      break;
    case "rule": {
      const r = state.approvedRules.find((x) => x.id === spec.ruleId);
      body = r ? <RuleView rule={r} /> : <Notice tone="amber">ההנחיה אינה זמינה.</Notice>;
      break;
    }
    case "history":
      body = <HistoryList filter={spec.filter} />;
      break;
    case "calculation":
      body = <CalculationView findingId={spec.findingId} />;
      break;
    case "conversation": {
      const c = state.conversations.find((x) => x.id === spec.conversationId);
      body = c ? <ConversationView conversation={c} /> : <Notice tone="amber">השיחה אינה זמינה.</Notice>;
      break;
    }
    case "pilot":
      body = <PilotPanel />;
      break;
    case "workbook":
      body = null;
      break;
  }
  return (
    <Surface kind={meta.kind} title={meta.title} subtitle={meta.subtitle} wide={meta.wide} onClose={ui.close}>
      {body}
    </Surface>
  );
}
