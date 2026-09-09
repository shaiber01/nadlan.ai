import { useState } from "react";
import { Surface } from "../components/Drawer";
import { Button } from "../components/primitives";
import { store, useUi, useV2State } from "./app/store";
import { DocumentView } from "./components/DocumentView";
import { SCRIPT_INVOICE_ID, pkg } from "./engine/commands";
import { ErpApp } from "./features/erp/ErpApp";

/**
 * The simulated ERP's page (`hadarim.html`): a presenter strip on top, then "זיו — סביבת הדגמה". Its
 * edits are written to the shared database. The control report lives on its own page (`report.html`)
 * and the ERP never links to it.
 */
export function HadarimApp() {
  const ui = useUi();
  const state = useV2State();
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingVariant, setPendingVariant] = useState<"A" | "B" | null>(null);
  const doc = ui.viewer.documentId ? pkg.documents.find((d) => d.id === ui.viewer.documentId) : null;
  const untouched = state.control.status === "idle" && state.audit.length === 0 && state.erp.changeLog.length === pkg.changeLog.length - (state.variant === "B" ? 1 : 0);
  // switching the scene-1 variant re-seeds the data (variant B has no invoice 1147 until it is keyed in)
  const chooseVariant = (variant: "A" | "B") => {
    if (variant === state.variant) return;
    if (untouched) void store.reset(variant);
    else setPendingVariant(variant);
  };

  return (
    <div className="h2-shell" dir="rtl">
      {ui.presenter.showPresenterBar && (
        <div className="h2-presenter no-print" data-testid="presenter-bar">
          <div className="h2-presenter-group">
            <span className="h2-presenter-brand">אב-טיפוס · {pkg.project.nameHe}</span>
            <span className="h2-presenter-screen">מערכת המידע (זיו)</span>
          </div>
          <div className="h2-presenter-group">
            <span className={`h2-presenter-db is-${ui.db.status}`} data-testid="db-status" title={ui.db.error ?? (ui.db.lastSync ? `סנכרון אחרון ${new Date(ui.db.lastSync).toLocaleTimeString("he-IL")}` : "")}>
              {ui.db.status === "online" ? (ui.db.syncing ? "מסד נתונים · שומר…" : "מסד נתונים · מחובר") : ui.db.status === "loading" ? "מסד נתונים · מתחבר…" : ui.db.status === "error" ? "מסד נתונים · שגיאה" : "ללא מסד נתונים (מקומי)"}
            </span>
            <label className="h2-presenter-toggle">
              <input type="checkbox" checked={ui.db.status === "offline"} onChange={(e) => store.setOffline(e.target.checked)} data-testid="db-offline" />
              עבודה מקומית
            </label>
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
      <div className="h2-body">
        <ErpApp />
      </div>
      {doc && (
        <Surface kind="modal" title={doc.titleHe} subtitle={`${doc.fileName} · ${doc.date.split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".")}`} onClose={store.closeDocument} wide>
          <DocumentView documentId={doc.id} anchor={ui.viewer.documentAnchor ?? undefined} />
        </Surface>
      )}
    </div>
  );
}
