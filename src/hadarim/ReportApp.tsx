import { Surface } from "./components/Drawer";
import { store, useUi, useV2State } from "./app/store";
import { DocumentView } from "./components/DocumentView";
import { pkg } from "./engine/commands";
import { RecordModal } from "./features/report/RecordModal";
import { ReportView } from "./features/report/ReportView";
import { dateHe } from "./features/report/fmt";

/**
 * The control report's own page (`report.html`): a live, read-only view of the session the Claude agent
 * ("בקרה") writes to the database, with the saved versions. It has its own header and none of the ERP's
 * presenter controls; source links open ERP records in a new tab, and the ERP never links here.
 */
export function ReportApp() {
  const ui = useUi();
  const state = useV2State();
  const doc = ui.viewer.documentId ? pkg.documents.find((d) => d.id === ui.viewer.documentId) : null;
  return (
    <div className="h2-shell h2-shell-report" dir="rtl">
      <header className="h2r-header no-print" data-testid="report-header">
        <div className="h2r-brand">
          <span className="h2r-logo" aria-hidden="true">
            ב
          </span>
          <div>
            <div className="h2r-title">דוח בקרה תקציבית</div>
            <div className="muted small">
              {pkg.project.nameHe} · {pkg.project.companyHe} · בקרה {dateHe(state.control.controlDate)}
            </div>
          </div>
        </div>
        <span className={`h2-presenter-db is-${ui.db.status}`} data-testid="db-status" title={ui.db.error ?? (ui.db.lastSync ? `סנכרון אחרון ${new Date(ui.db.lastSync).toLocaleTimeString("he-IL")}` : "")}>
          {ui.db.status === "online" ? (ui.db.syncing ? "מסד נתונים · שומר…" : "מסד נתונים · מחובר") : ui.db.status === "loading" ? "מסד נתונים · מתחבר…" : ui.db.status === "error" ? "מסד נתונים · שגיאה" : "ללא מסד נתונים (מקומי)"}
        </span>
      </header>
      <div className="h2-body">
        <ReportView />
      </div>
      {ui.viewer.recordRef ? <RecordModal recordRef={ui.viewer.recordRef} /> : null}
      {doc && (
        <Surface kind="modal" title={doc.titleHe} subtitle={`${doc.fileName} · ${dateHe(doc.date)}`} onClose={store.closeDocument} wide>
          <DocumentView documentId={doc.id} anchor={ui.viewer.documentAnchor ?? undefined} />
        </Surface>
      )}
    </div>
  );
}
