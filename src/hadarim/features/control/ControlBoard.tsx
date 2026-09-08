import { Badge, Button } from "../../../components/primitives";
import { store, useV2State } from "../../app/store";
import { sectionLabel } from "../../engine/checks";
import { allIssues, pkg } from "../../engine/commands";
import type { WorkingForecast } from "../../engine/forecast";
import { FINDING_KIND_HE, dateHe, decisionStatusHe, mil, nis } from "./fmt";

/** Side board: headline forecast, findings progress, open tasks and the report entry point. */
export function ControlBoard({ wf }: { wf: WorkingForecast }) {
  const state = useV2State();
  const { control } = state;
  const variance = wf.totalEac - wf.totalBudget;
  const decided = control.findings.filter((f) => {
    const d = control.decisions[f.id];
    return d && d.status !== "open";
  }).length;
  const reportReady = control.status === "report" || control.adjustments.length > 0;
  const issues = allIssues(state).filter((t) => t.status !== "closed");
  const personHe = (id: string) => pkg.people.find((p) => p.id === id)?.nameHe ?? id;

  return (
    <div className="h2c-board">
      <section className="card h2c-board-card">
        <div className="h2c-board-label">תחזית לגמר · בקרה {dateHe(control.controlDate)}</div>
        <div className="h2c-board-headline" data-testid="control-headline">
          {nis(wf.totalEac)}
        </div>
        <div className="h2c-board-trend">
          <span className="muted">{mil(wf.previousTotalEac)}</span>
          <span aria-hidden="true">←</span>
          <strong>{mil(wf.totalEac)}</strong>
        </div>
        <dl className="h2c-board-kv">
          <dt>תקציב מאושר</dt>
          <dd>{nis(wf.totalBudget)}</dd>
          <dt>סטייה</dt>
          <dd className={variance > 0 ? "h2c-neg" : variance < 0 ? "h2c-pos" : ""} data-testid="control-variance">
            {variance === 0 ? "—" : `${variance > 0 ? "+" : "−"}${nis(Math.abs(variance))}`}
            {variance !== 0 ? <span className="muted small"> ({((variance / wf.totalBudget) * 100).toFixed(2)}%)</span> : null}
          </dd>
          <dt>נרשם</dt>
          <dd>{nis(wf.totalRecorded)}</dd>
          <dt>יתרה לא מכוסה (כולל בלתי צפוי)</dt>
          <dd>{nis(wf.totalUncovered)}</dd>
        </dl>
        <Button variant={reportReady ? "primary" : "secondary"} disabled={!reportReady} onClick={() => store.setUi((u) => ({ ...u, control: { ...u.control, pane: "report" } }))} data-testid="control-open-report" title={reportReady ? undefined : "הדוח ייפתח אחרי שכל הממצאים יטופלו"}>
          הדוח
        </Button>
        {control.finalized ? <Badge tone="green">גרסה סופית</Badge> : reportReady ? <Badge tone="amber">טיוטה</Badge> : null}
      </section>

      <section className="card h2c-board-card">
        <div className="card-title">
          <h3>ממצאים</h3>
          <span className="muted small" data-testid="control-progress">
            {control.findings.length ? `${decided} מתוך ${control.findings.length} הוחלטו` : "טרם הופעלה בקרה"}
          </span>
        </div>
        {control.findings.length ? (
          <ul className="h2c-board-list" data-testid="control-findings">
            {control.findings.map((f) => {
              const st = decisionStatusHe(control.decisions[f.id]);
              return (
                <li key={f.id} data-finding-id={f.id}>
                  <div className="h2c-board-item-title">
                    <span className="muted small">{FINDING_KIND_HE[f.kind]}</span>
                    <span>{f.titleHe}</span>
                  </div>
                  <Badge tone={st.tone} dot>
                    {st.labelHe}
                  </Badge>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted small">הממצאים יופיעו כאן אחרי הרצת הבקרה.</p>
        )}
        {control.positives.length ? (
          <div className="h2c-board-positive muted small">
            נבדק ונמצא תואם: {control.positives.map((p) => p.titleHe.split(":")[0]).join(", ")}
          </div>
        ) : null}
      </section>

      <section className="card h2c-board-card">
        <div className="card-title">
          <h3>נושאים לטיפול</h3>
          <span className="muted small">{issues.length}</span>
        </div>
        <ul className="h2c-board-list" data-testid="control-tasks">
          {issues.map((t) => (
            <li key={t.id}>
              <div className="h2c-board-item-title">
                <span>{t.titleHe}</span>
                <span className="muted small">
                  {t.sectionId ? `${sectionLabel(t.sectionId)} · ` : ""}
                  {personHe(t.ownerId)}
                  {t.dueDate ? ` · עד ${dateHe(t.dueDate)}` : ""}
                  {` · נפתח ${dateHe(t.openedInControl)}`}
                </span>
              </div>
              <Badge tone={t.status === "pending_execution" ? "navy" : "amber"}>{t.status === "pending_execution" ? "ממתין לביצוע" : "פתוח"}</Badge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
