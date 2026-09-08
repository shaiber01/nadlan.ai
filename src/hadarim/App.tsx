import { useState } from "react";
import { Surface } from "../components/Drawer";
import { Button } from "../components/primitives";
import { store, useUi, useV2State } from "./app/store";
import { DocumentView } from "./components/DocumentView";
import { pkg } from "./engine/commands";
import { ControlApp } from "./features/control/ControlApp";
import { ErpApp } from "./features/erp/ErpApp";

/**
 * Hadarim v2 shell: a presenter strip on top, then either the simulated ERP ("זיו — סביבת הדגמה")
 * or the control system ("בקרה"). Documents open in a modal hosted here so both apps share it.
 */
export function HadarimApp() {
  const ui = useUi();
  const state = useV2State();
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingVariant, setPendingVariant] = useState<"A" | "B" | null>(null);
  const operator = pkg.people.find((p) => p.id === state.operatorId)!;
  const doc = ui.control.documentId ? pkg.documents.find((d) => d.id === ui.control.documentId) : null;
  const untouched = state.control.status === "idle" && state.audit.length === 0 && state.erp.changeLog.length === pkg.changeLog.length - (state.variant === "B" ? 1 : 0);
  // switching the scene-1 variant re-seeds the demo (variant B has no invoice 1147 until it is keyed in)
  const chooseVariant = (variant: "A" | "B") => {
    if (variant === state.variant) return;
    if (untouched) store.reset(variant);
    else setPendingVariant(variant);
  };

  return (
    <div className="h2-shell" dir="rtl" data-app={ui.app}>
      {ui.presenter.showPresenterBar && (
        <div className="h2-presenter no-print" data-testid="presenter-bar">
          <div className="h2-presenter-group">
            <span className="h2-presenter-brand">הדגמה · הדרים</span>
            <div className="h2-switch" role="tablist" aria-label="מסכים">
              <button type="button" role="tab" aria-selected={ui.app === "erp"} className={ui.app === "erp" ? "active" : ""} onClick={() => store.go("erp")} data-testid="go-erp">
                מערכת המידע (זיו)
              </button>
              <button type="button" role="tab" aria-selected={ui.app === "control"} className={ui.app === "control" ? "active" : ""} onClick={() => store.go("control")} data-testid="go-control">
                בקרה
              </button>
            </div>
          </div>
          <div className="h2-presenter-group">
            <span className="h2-presenter-meta">
              משתמש: {operator.nameHe}, {operator.roleHe} · {state.clock.slice(0, 10).split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".")} {state.clock.slice(11, 16)}
            </span>
            <label className="h2-presenter-toggle">
              <input type="checkbox" checked={ui.presenter.skipMotion} onChange={(e) => store.setUi((u) => ({ ...u, presenter: { ...u.presenter, skipMotion: e.target.checked } }))} data-testid="skip-motion" />
              ללא אנימציה
            </label>
            <label className="h2-presenter-toggle">
              סצנה 1:
              <select value={state.variant} onChange={(e) => chooseVariant(e.target.value as "A" | "B")} data-testid="scene1-variant">
                <option value="A">א — שינוי שיוך (1147 קיים)</option>
                <option value="B">ב — קליטת חשבון 1147</option>
              </select>
            </label>
            {pendingVariant ? (
              <span className="h2-presenter-confirm">
                החלפת הגרסה מאפסת את ההדגמה.
                <Button size="sm" variant="danger" onClick={() => { store.reset(pendingVariant); setPendingVariant(null); }} data-testid="variant-confirm">
                  אפס והחלף
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPendingVariant(null)}>
                  ביטול
                </Button>
              </span>
            ) : null}
            {confirmReset ? (
              <span className="h2-presenter-confirm">
                לאפס את ההדגמה?
                <Button size="sm" variant="danger" onClick={() => { store.reset(); setConfirmReset(false); }} data-testid="reset-confirm">
                  כן, אפס
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                  ביטול
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" className="h2-presenter-reset" onClick={() => setConfirmReset(true)} data-testid="reset-demo">
                איפוס הדגמה
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="h2-body">{ui.app === "erp" ? <ErpApp /> : <ControlApp />}</div>
      {doc && (
        <Surface kind="modal" title={doc.titleHe} subtitle={`${doc.fileName} · ${doc.date.split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".")}`} onClose={store.closeDocument} wide>
          <DocumentView documentId={doc.id} anchor={ui.control.documentAnchor ?? undefined} />
        </Surface>
      )}
    </div>
  );
}
