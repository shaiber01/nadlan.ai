import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Chip } from "../../../components/primitives";
import { store, useUi, useV2State } from "../../app/store";
import { finalizeControl, pkg, saveConfig, savePromptHe, sendReport, setReportConfig } from "../../engine/commands";
import { buildReport } from "../../engine/report";
import { exportReportDocx } from "../../export/docx";
import { AppendicesSection, CeoPage, ChangesSection, ContingencySection, ExecutiveSection, HeaderSection, IssuesSection, MaterialSection, ReportFooter, RisksSection, SECTION_TITLES, SectionsTableSection, StatusSection, TrendsSection, VerifiedSection, scrollToSection } from "./sections";
import "./report.css";

/**
 * The living control report. Reads the store, builds the ReportModel and renders it — the full report
 * (standard §3, sections 0–11) or the one-page CEO version (standard §4). Exports: browser print (PDF)
 * and a real Word document.
 */
export function ReportView() {
  const state = useV2State();
  const ui = useUi();
  const report = useMemo(() => buildReport(pkg, state), [state]);
  const config = state.control.reportConfig;
  const tab: "full" | "ceo" = ui.control.reportTab === "ceo" && config.ceoVersion ? "ceo" : "full";
  const [busy, setBusy] = useState<"docx" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savePrompt, setSavePrompt] = useState(false);
  const ceo = pkg.people.find((p) => /^מנכ/.test(p.roleHe));
  const docxFile = `בקרה_${pkg.project.nameHe}_${state.control.controlDate.slice(0, 7)}${tab === "ceo" ? "_מנכל" : ""}.docx`;

  const setTab = (next: "full" | "ceo") => store.setUi((u) => ({ ...u, control: { ...u.control, reportTab: next } }));

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

  // exports requested from the chat (scene 7: [ייצוא PDF] [ייצוא Word]) run once the pane is mounted
  const pendingExport = ui.control.pendingExport ?? null;
  useEffect(() => {
    if (!pendingExport) return;
    store.clearExport();
    if (pendingExport === "pdf") exportPdf();
    else void exportDocx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingExport]);

  const toggle = (patch: Partial<typeof config>) => {
    store.dispatch((s) => setReportConfig(s, patch));
    if (patch.ceoVersion === false && tab === "ceo") setTab("full");
  };

  return (
    <section className="h2-report" data-testid="report-view" data-tab={tab}>
      <div className="h2-report-toolbar no-print">
        <div className="h2-report-toolbar-row">
          <div className="tabs h2-report-tabs" role="tablist">
            <button type="button" role="tab" className="tab" aria-selected={tab === "full"} onClick={() => setTab("full")} data-testid="report-tab-full">
              דוח מלא
            </button>
            {config.ceoVersion ? (
              <button type="button" role="tab" className="tab" aria-selected={tab === "ceo"} onClick={() => setTab("ceo")} data-testid="report-tab-ceo">
                גרסה למנכ״לית
              </button>
            ) : null}
          </div>
          <span data-testid="report-version">
            <Badge tone={report.finalized ? "green" : "amber"} dot>
              {report.header.controlLabelHe}
            </Badge>
          </span>
          <div className="row h2-report-actions">
            <Button size="sm" onClick={exportPdf} data-testid="report-export-pdf">
              ייצוא PDF
            </Button>
            <Button size="sm" onClick={exportDocx} busy={busy === "docx"} data-testid="report-export-docx">
              ייצוא Word
            </Button>
            {config.ceoVersion && ceo ? (
              <Button size="sm" onClick={() => store.dispatch((s) => sendReport(s, ceo.id))} data-testid="report-send-ceo" title="מסירה: אין תיבת דואר באב-טיפוס — המסירה נרשמת ביומן הבקרה">
                שלח ל{ceo.nameHe}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setSavePrompt(true)} data-testid="report-save-config" title={state.savedConfig ? `נשמר: ${state.savedConfig.savedAs}` : "שמירת מבנה הדוח לבקרות הבאות"}>
              {state.savedConfig ? `נשמר: ${state.savedConfig.savedAs}` : "שמור תצורה"}
            </Button>
            <Button size="sm" variant="primary" onClick={() => store.dispatch(finalizeControl)} disabled={report.finalized} data-testid="report-finalize">
              {report.finalized ? "גרסה סופית" : "סגור כגרסה סופית"}
            </Button>
          </div>
        </div>
        {savePrompt ? (
          <div className="h2-report-toolbar-row h2-report-save-prompt" role="dialog" aria-label="שמירת תצורה" data-testid="report-save-prompt">
            <span className="small">{savePromptHe(config)}</span>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                store.dispatch((s) => saveConfig(s, true));
                setSavePrompt(false);
              }}
              data-testid="report-save-confirm"
            >
              שמור
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                store.dispatch((s) => saveConfig(s, false));
                setSavePrompt(false);
              }}
              data-testid="report-save-later"
            >
              לא עכשיו
            </Button>
          </div>
        ) : null}
        <div className="h2-report-toolbar-row h2-report-chips">
          <span className="muted small">מבנה הדוח:</span>
          <Chip active={config.includeTrends} onClick={() => toggle({ includeTrends: !config.includeTrends })} data-testid="report-toggle-trends">
            השוואה ומגמות
          </Chip>
          <Chip active={config.splitByBuilding} onClick={() => toggle({ splitByBuilding: !config.splitByBuilding })} data-testid="report-toggle-building">
            פילוח לפי בניין
          </Chip>
          <Chip active={config.ceoVersion} onClick={() => toggle({ ceoVersion: !config.ceoVersion })} data-testid="report-toggle-ceo">
            גרסה למנכ״לית
          </Chip>
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
          <VerifiedSection report={report} />
          <TrendsSection report={report} />
          <AppendicesSection report={report} />
          <ReportFooter />
        </article>
      )}
    </section>
  );
}
