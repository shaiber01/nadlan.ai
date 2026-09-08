import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * UI-only state: a stack of open drawers (documents, records, findings, proposals, reports, rules,
 * history, calculations). Domain state never lives here.
 */
export type DrawerSpec =
  | { kind: "document"; documentId: string; anchorId?: string; version?: number }
  | { kind: "record"; recordId: string }
  | { kind: "finding"; findingId: string }
  | { kind: "proposal"; proposalId: string }
  | { kind: "report"; reportId: string }
  | { kind: "rule"; ruleId: string }
  | { kind: "history"; filter?: { projectId?: string; costCodeId?: string; recordId?: string } }
  | { kind: "calculation"; findingId: string }
  | { kind: "conversation"; conversationId: string }
  | { kind: "pilot" }
  | { kind: "workbook"; reportId: string };

interface UiContextValue {
  stack: DrawerSpec[];
  open: (spec: DrawerSpec) => void;
  close: () => void;
  closeAll: () => void;
  openDocument: (documentId: string, anchorId?: string, version?: number) => void;
  openRecord: (recordId: string) => void;
  openFinding: (findingId: string) => void;
  openProposal: (proposalId: string) => void;
  openReport: (reportId: string) => void;
  openRule: (ruleId: string) => void;
  openHistory: (filter?: { projectId?: string; costCodeId?: string; recordId?: string }) => void;
  openCalculation: (findingId: string) => void;
  openConversation: (conversationId: string) => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<DrawerSpec[]>([]);
  const open = useCallback((spec: DrawerSpec) => setStack((s) => [...s, spec]), []);
  const close = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const closeAll = useCallback(() => setStack([]), []);
  const value = useMemo<UiContextValue>(
    () => ({
      stack,
      open,
      close,
      closeAll,
      openDocument: (documentId, anchorId, version) => open({ kind: "document", documentId, anchorId, version }),
      openRecord: (recordId) => open({ kind: "record", recordId }),
      openFinding: (findingId) => open({ kind: "finding", findingId }),
      openProposal: (proposalId) => open({ kind: "proposal", proposalId }),
      openReport: (reportId) => open({ kind: "report", reportId }),
      openRule: (ruleId) => open({ kind: "rule", ruleId }),
      openHistory: (filter) => open({ kind: "history", filter }),
      openCalculation: (findingId) => open({ kind: "calculation", findingId }),
      openConversation: (conversationId) => open({ kind: "conversation", conversationId }),
    }),
    [stack, open, close, closeAll],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiContextValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi outside UiProvider");
  return ctx;
}
