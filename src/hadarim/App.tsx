import { useState } from "react";
import { Surface } from "../components/Drawer";
import { Button } from "../components/primitives";
import { store, useUi, useV2State } from "./app/store";
import { DocumentView } from "./components/DocumentView";
import { SCRIPT_INVOICE_ID, pkg } from "./engine/commands";
import { ErpApp } from "./features/erp/ErpApp";
import { RecordModal } from "./features/report/RecordModal";
import { ReportView } from "./features/report/ReportView";

/**
 * Hadarim shell: a presenter strip on top, then either the simulated ERP ("זיו — סביבת הדגמה") or the
 * control report — a live, read-only view of the session the Claude agent ("בקרה") writes to the
 * database. Documents and ERP records open in modals hosted here so both screens share them.
 */
export function HadarimApp() {
  const ui = useUi();
  const state = useV2State();
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingVariant, setPendingVariant] = useState<"A" | "B" | null>(null);
  const operator = pkg.people.find((p) => p.id === state.operatorId);
  const doc = ui.viewer.documentId ? pkg.documents.find((d) => d.id === ui.viewer.documentId) : null;
  const untouched = state.control.status === "idle" && state.audit.length === 0 && state.erp.changeLog.length === pkg.changeLog.length - (state.variant === "B" ? 1 : 0);
  // switching the scene-1 variant re-seeds the data (variant B has no invoice 1147 until it is keyed in)
  const chooseVariant = (variant: "A" | "B") => {
    if (variant === state.variant) return;
    if (untouched) void store.reset(variant);
    else setPendingVariant(variant);
  };

  return (
    <div className="h2-shell" dir="rtl" data-app={ui.app}>
      {ui.presenter.showPresenterBar && (
        <div className="h2-presenter no-print" data-testid="presenter-bar">
          <div className="h2-presenter-group">
            <span className="h2-presenter-brand">אב-טיפוס · {pkg.project.nameHe}</span>
            <div className="h2-switch" role="tablist" aria-label="מסכים">
              <button type="button" role="tab" aria-selected={ui.app === "erp"} className={ui.app === "erp" ? "active" : ""} onClick={() => store.go("erp")} data-testid="go-erp">
                מערכת המידע (זיו)
              </button>
              <button type="button" role="tab" aria-selected={ui.app === "report"} className={ui.app === "report" ? "active" : ""} onClick={() => store.go("report")} data-testid="go-report">
                דוח הבקרה
              </button>
            </div>
          </div>
          <div className="h2-presenter-group">
            <span className={`h2-presenter-db is-${ui.db.status}`} data-testid="db-status" title={ui.db.error ?? (ui.db.lastSync ? `סנכרון אחרון ${new Date(ui.db.lastSync).toLocaleTimeString("he-IL")}` : "")}>
              {ui.db.status === "online" ? (ui.db.syncing ? "מסד נתונים · שומר…" : "מסד נתונים · מחובר") : ui.db.status === "loading" ? "מסד נתונים · מתחבר…" : ui.db.status === "error" ? "מסד נתונים · שגיאה" : "ללא מסד נתונים (מקומי)"}
            </span>
            <label className="h2-presenter-toggle">
              <input type="checkbox" checked={ui.db.status === "offline"} onChange={(e) => store.setOffline(e.target.checked)} data-testid="db-offline" />
              עבודה מקומית
            </label>
            {operator ? (
              <span className="h2-presenter-meta">
                מבקר: {operator.nameHe}, {operator.roleHe}
              </span>
            ) : null}
            <label className="h2-presenter-toggle">
              סצנה 1:
              <select value={state.variant} onChange={(e) => chooseVariant(e.target.value as "A" | "B")} data-testid="scene1-variant">
                <option value="A">א — שינוי שיוך (חשבון {SCRIPT_INVOICE_ID} קיים)</option>
                <option value="B">ב — קליטת החשבון מחדש (ללא {SCRIPT_INVOICE_ID})</option>
              </select>
            </label>
            {pendingVariant ? (
              <span className="h2-presenter-confirm">
                החלפת הגרסה מאפסת את הנתונים.
                <Button size="sm" variant="danger" onClick={() => { void store.reset(pendingVariant); setPendingVariant(null); }} data-testid="variant-confirm">
                  אפס והחלף
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPendingVariant(null)}>
                  ביטול
                </Button>
              </span>
            ) : null}
            {confirmReset ? (
              <span className="h2-presenter-confirm">
                לאפס לנתוני הבסיס? הבקרה הנוכחית וההיסטוריה של היום יימחקו.
                <Button size="sm" variant="danger" onClick={() => { void store.reset(); setConfirmReset(false); }} data-testid="reset-confirm">
                  כן, אפס
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                  ביטול
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" className="h2-presenter-reset" onClick={() => setConfirmReset(true)} data-testid="reset-demo">
                איפוס לנתוני הבסיס
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="h2-body">{ui.app === "erp" ? <ErpApp /> : <ReportView />}</div>
      {ui.viewer.recordRef ? <RecordModal recordRef={ui.viewer.recordRef} /> : null}
      {doc && (
        <Surface kind="modal" title={doc.titleHe} subtitle={`${doc.fileName} · ${doc.date.split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".")}`} onClose={store.closeDocument} wide>
          <DocumentView documentId={doc.id} anchor={ui.viewer.documentAnchor ?? undefined} />
        </Surface>
      )}
    </div>
  );
}
