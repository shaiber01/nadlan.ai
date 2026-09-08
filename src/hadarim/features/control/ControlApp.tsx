import { useMemo } from "react";
import { Badge, Button } from "../../../components/primitives";
import { store, useUi, useV2State } from "../../app/store";
import { pkg } from "../../engine/commands";
import { workingForecast } from "../../engine/forecast";
import { ReportView } from "../report/ReportView";
import { ChatView } from "./ChatView";
import { ControlBoard } from "./ControlBoard";
import { RecordModal } from "./RecordModal";
import { dateHe } from "./fmt";
import "./control.css";

/** The control system ("בקרה"): conversation in the main column, the control board at the side, the report in place of the chat when opened. */
export function ControlApp() {
  const state = useV2State();
  const ui = useUi();
  const wf = useMemo(() => workingForecast(pkg, state.erp, state.control.adjustments, state.control.controlDate), [state.erp, state.control.adjustments, state.control.controlDate]);
  const operator = pkg.people.find((p) => p.id === state.operatorId)!;
  const statusHe = state.control.finalized ? { labelHe: "גרסה סופית", tone: "green" as const } : state.control.status === "idle" ? { labelHe: "לא הופעלה", tone: "neutral" as const } : state.control.status === "report" ? { labelHe: "טיוטת דוח", tone: "amber" as const } : { labelHe: state.control.status === "running" ? "בבדיקה" : "בהחלטות", tone: "primary" as const };
  const showReport = ui.control.pane === "report";

  return (
    <main className="h2c" data-testid="control-app" data-pane={ui.control.pane}>
      <header className="h2c-header no-print">
        <div className="h2c-brand">
          <span className="h2c-logo" aria-hidden="true">
            ב
          </span>
          <div>
            <div className="h2c-product">בקרה</div>
            <div className="muted small">בקרה תקציבית · {pkg.project.companyHe}</div>
          </div>
        </div>
        <div className="h2c-header-meta">
          <span>
            פרויקט <strong>{pkg.project.nameHe}</strong>
          </span>
          <span>
            בקרה <strong>{dateHe(state.control.controlDate)}</strong>
          </span>
          <Badge tone={statusHe.tone} dot>
            {statusHe.labelHe}
          </Badge>
          <span className="muted">
            {operator.nameHe} · {operator.roleHe}
          </span>
        </div>
      </header>
      <div className="h2c-layout">
        <section className="h2c-main">
          {showReport ? (
            <>
              <div className="h2c-report-bar no-print">
                <Button variant="ghost" onClick={() => store.setUi((u) => ({ ...u, control: { ...u.control, pane: "chat" } }))} data-testid="control-back-to-chat">
                  → חזרה לשיחה
                </Button>
                <span className="muted small">הדוח נבנה מהבקרה הפעילה; שינויים בשיחה מתעדכנים כאן.</span>
              </div>
              <ReportView />
            </>
          ) : (
            <ChatView />
          )}
        </section>
        <aside className="h2c-side no-print">
          <ControlBoard wf={wf} />
        </aside>
      </div>
      {ui.control.recordRef ? <RecordModal recordRef={ui.control.recordRef} /> : null}
    </main>
  );
}
