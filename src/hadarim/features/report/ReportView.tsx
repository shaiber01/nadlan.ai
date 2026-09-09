import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Notice } from "../../../components/primitives";
import { store, useReportVersions, useUi, useV2State } from "../../app/store";
import { pkg } from "../../engine/commands";
import { buildReport, type ReportModel } from "../../engine/report";
import { exportReportDocx } from "../../export/docx";
import { dateHe, timeHe } from "./fmt";
import { AppendicesSection, CeoPage, ChangesSection, ContingencySection, ExecutiveSection, HeaderSection, IssuesSection, MaterialSection, OpenFindingsSection, ReportFooter, RisksSection, SECTION_TITLES, SectionsTableSection, StatusSection, TrendsSection, VerifiedSection, scrollToSection } from "./sections";
import "./report.css";

/**
 * The control report as a live, read-only view of the agent's work. The session (findings, decisions,
 * adjustments, corrections, tasks, notes, report configuration) is what the Claude agent wrote to the
 * database through its tools; the report is rebuilt from it here on every change (Realtime). Saved
 * versions can be opened next to the live one. Exports: browser print (PDF) and a real Word document.
 * Nothing in the control is edited from this screen.
 */
export function ReportView() {
  const state = useV2State();
  const ui = useUi();
  const versions = useReportVersions();
  const [saved, setSaved] = useState<{ id: number; model: ReportModel; label: string | null } | null>(null);
  const [busy, setBusy] = useState<"docx" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = useMemo(() => buildReport(pkg, state), [state]);
  const selectedId = ui.report.versionId;
  useEffect(() => {
    if (selectedId == null) {
      setSaved(null);
      return;
    }
    let cancelled = false;
    store
      .loadVersion(selectedId)
      .then((v) => {
        if (cancelled) return;
        if (!v) {
          store.selectVersion(null);
          return;
        }
        setSaved({ id: v.id, model: v.model as ReportModel, label: v.label });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const report = saved && saved.id === selectedId ? saved.model : live;
  const isLive = !(saved && saved.id === selectedId);
  const ceoAvailable = isLive ? state.control.reportConfig.ceoVersion : true;
  const tab: "full" | "ceo" = ui.report.tab === "ceo" && ceoAvailable ? "ceo" : "full";
  const c = state.control;
  const decided = c.findings.filter((f) => c.decisions[f.id] && c.decisions[f.id].status !== "open" && !c.decisions[f.id].pending).length;
  const status = c.finalized ? { labelHe: "גרסה סופית", tone: "green" as const } : c.status === "idle" ? { labelHe: "לא הופעלה בקרה", tone: "neutral" as const } : c.status === "report" ? { labelHe: "טיוטת דוח — כל הממצאים טופלו", tone: "amber" as const } : { labelHe: `בעבודה — ${c.findings.length} ממצאים, ${decided} הוחלטו`, tone: "primary" as const };
  const operator = pkg.people.find((p) => p.id === state.operatorId);
  const personHe = (id: string) => pkg.people.find((p) => p.id === id)?.nameHe ?? id;
  const docxFile = `בקרה_${pkg.project.nameHe}_${c.controlDate.slice(0, 7)}${tab === "ceo" ? "_מנכל" : ""}${isLive ? "" : `_v${selectedId}`}.docx`;

  const exportPdf = () => {
    setError(null);
    document.body.classList.remove("printing-report");
    document.body.classList.add("printing-report");
    const cleanup = () => document.body.classList.remove("printing-report");
    window.addEventListener("afterprint", cleanup, { once: true });
    try {
      window.print();
    } catch (e) {
      cleanup();
      setError(e instanceof Error ? e.message : "ההדפסה נכשלה");
    }
  };

  const exportDocx = async () => {
    setError(null);
    setBusy("docx");
    try {
      const blob = await exportReportDocx(report, tab);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = docxFile;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "יצירת קובץ Word נכשלה");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="h2-report" data-testid="report-view" data-tab={tab} data-source={isLive ? "live" : "saved"}>
      <div className="h2-report-toolbar no-print">
        <div className="h2-report-toolbar-row">
          <div className="tabs h2-report-tabs" role="tablist">
            <button type="button" role="tab" className="tab" aria-selected={tab === "full"} onClick={() => store.setReportTab("full")} data-testid="report-tab-full">
              דוח מלא
            </button>
            {ceoAvailable ? (
              <button type="button" role="tab" className="tab" aria-selected={tab === "ceo"} onClick={() => store.setReportTab("ceo")} data-testid="report-tab-ceo">
                גרסה למנכ״לית
              </button>
            ) : null}
          </div>
          <span data-testid="report-version">
            <Badge tone={report.finalized ? "green" : "amber"} dot>
              {report.header.controlLabelHe}
            </Badge>
          </span>
          <label className="h2-report-version-pick small">
            גרסה:
            <select value={selectedId ?? ""} onChange={(e) => store.selectVersion(e.target.value ? Number(e.target.value) : null)} data-testid="report-version-select">
              <option value="">חיה — הבקרה הפעילה</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  #{v.id} · {v.label ?? "ללא תווית"} · {dateHe(v.createdAt)} {timeHe(new Date(v.createdAt).toISOString().replace("T", "T"))} · {personHe(v.createdBy)}
                </option>
              ))}
            </select>
          </label>
          <div className="row h2-report-actions">
            <Button size="sm" onClick={exportPdf} data-testid="report-export-pdf">
              ייצוא PDF
            </Button>
            <Button size="sm" onClick={exportDocx} busy={busy === "docx"} data-testid="report-export-docx">
              ייצוא Word
            </Button>
          </div>
        </div>
        <div className="h2-report-toolbar-row h2-report-status" data-testid="report-status">
          <Badge tone={status.tone} dot>
            {status.labelHe}
          </Badge>
          {operator ? (
            <span className="muted small">
              מבקר: {operator.nameHe}, {operator.roleHe}
            </span>
          ) : null}
          <span className="muted small" data-testid="report-source">
            {ui.db.status === "online" ? `מסד הנתונים · עודכן ${ui.db.lastSync ? new Date(ui.db.lastSync).toLocaleTimeString("he-IL") : "—"}` : ui.db.status === "loading" ? "מתחבר למסד הנתונים…" : "נתונים מקומיים (ללא מסד נתונים)"}
          </span>
          <span className="muted small h2-report-agent-hint" data-testid="report-agent-hint">
            הבקרה מתנהלת עם הסוכן ״בקרה״ (<code>claude --agent bakara</code>); הדוח כאן מתעדכן מהחלטותיו.
          </span>
          {tab === "full" ? (
            <nav className="h2-report-nav" aria-label="ניווט בדוח">
              {SECTION_TITLES.filter((s) => s.n !== "10" || report.trends.comparison).map((s) => (
                <button key={s.n} type="button" onClick={() => scrollToSection(s.n)}>
                  {s.n}
                </button>
              ))}
            </nav>
          ) : null}
        </div>
        {error ? (
          <div className="error-text" role="alert">
            {error}
          </div>
        ) : null}
      </div>
      {isLive && c.status === "idle" ? (
        <div data-testid="report-idle-notice">
          <Notice tone="navy">הבקרה ל-{dateHe(c.controlDate)} טרם הופעלה. מוצגים טיוטת התחזית והנתונים החיים ממערכת המידע; הממצאים, ההחלטות והשינויים בתחזית יופיעו כאן כשהסוכן יריץ את הבקרה.</Notice>
        </div>
      ) : null}
      {!isLive ? (
        <div data-testid="report-saved-notice">
          <Notice tone="amber">
            גרסה שמורה #{selectedId}
            {saved?.label ? ` — ${saved.label}` : ""}. הנתונים כפי שנשמרו; הדוח החי עשוי להיות שונה.
          </Notice>
        </div>
      ) : null}
      {tab === "ceo" ? (
        <CeoPage report={report} />
      ) : (
        <article className="h2-report-doc" data-testid="report-full">
          <HeaderSection report={report} />
          <ExecutiveSection report={report} />
          <StatusSection report={report} />
          <SectionsTableSection report={report} />
          <ChangesSection report={report} />
          <MaterialSection report={report} />
          <ContingencySection report={report} />
          <RisksSection report={report} />
          <IssuesSection report={report} />
          <OpenFindingsSection report={report} />
          <VerifiedSection report={report} />
          <TrendsSection report={report} />
          <AppendicesSection report={report} />
          <ReportFooter />
        </article>
      )}
    </section>
  );
}
