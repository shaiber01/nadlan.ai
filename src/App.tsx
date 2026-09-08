import { useEffect, useRef, useState } from "react";
import { navigate, routeWith, useRoute, type RouteName } from "./app/router";
import { store, useDemo } from "./app/store";
import { UiProvider, useUi } from "./app/ui";
import { DrawerHost } from "./components/DrawerHost";
import { Surface } from "./components/Drawer";
import { GuidePanel } from "./components/GuidePanel";
import { Badge, Bidi, Button, Chip, Notice } from "./components/primitives";
import { branding } from "./config/branding";
import { advanceDemoClock } from "./domain/commands/reports";
import { formatDateTime } from "./domain/dates";
import { he } from "./locales/he";
import { BudgetPage } from "./features/budget/BudgetPage";
import { ChatPage } from "./features/chat/ChatPage";
import { DocumentsPage } from "./features/documents/DocumentsPage";
import { KnowledgePage } from "./features/knowledge/KnowledgePage";
import { OverviewPage } from "./features/overview/OverviewPage";
import { ProjectsPage } from "./features/projects/ProjectsPage";
import { QuestionsPage } from "./features/questions/QuestionsPage";
import { RecordsPage } from "./features/records/RecordsPage";
import { ReportsPage } from "./features/reports/ReportsPage";
import { ScenariosPage } from "./features/scenarios/ScenariosPage";

const NAV: { name: RouteName; labelHe: string }[] = [
  { name: "overview", labelHe: he.nav.overview },
  { name: "projects", labelHe: he.nav.projects },
  { name: "budget", labelHe: he.nav.budget },
  { name: "records", labelHe: he.nav.records },
  { name: "documents", labelHe: he.nav.documents },
  { name: "questions", labelHe: he.nav.questions },
  { name: "reports", labelHe: he.nav.reports },
  { name: "chat", labelHe: he.nav.chat },
  { name: "knowledge", labelHe: he.nav.knowledge },
  { name: "scenarios", labelHe: he.nav.scenarios },
];

function Page({ name }: { name: RouteName }) {
  switch (name) {
    case "overview":
      return <OverviewPage />;
    case "projects":
      return <ProjectsPage />;
    case "budget":
      return <BudgetPage />;
    case "records":
      return <RecordsPage />;
    case "documents":
      return <DocumentsPage />;
    case "questions":
      return <QuestionsPage />;
    case "reports":
      return <ReportsPage />;
    case "chat":
      return <ChatPage />;
    case "knowledge":
      return <KnowledgePage />;
    case "scenarios":
      return <ScenariosPage />;
  }
}

function Toasts() {
  const { toasts } = useDemo();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status">
          <span>{t.textHe}</span>
          <button type="button" className="icon-btn" style={{ color: "#fff" }} aria-label="סגור" onClick={() => store.dismissToast(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function Shell() {
  const { state, mode, ui, incompatibleStorage, analyzing, scenario } = useDemo();
  const route = useRoute();
  const uiCtx = useUi();
  const [confirmReset, setConfirmReset] = useState(false);
  const [presenterOpen, setPresenterOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const openProposals = state.proposals.filter((p) => p.status === "pending_review" || p.status === "apply_failed").length;
  const openQuestions = state.questions.filter((q) => ["pending_review", "ready", "sent", "open"].includes(q.status)).length + state.alerts.filter((a) => a.status === "pending_review").length;
  const pendingReports = state.reports.filter((r) => r.status === "pending_review").length;

  useEffect(() => {
    const projectParam = route.params.get("project");
    if (projectParam && projectParam !== state.activeProjectId && state.projects.some((p) => p.id === projectParam)) store.setActiveProject(projectParam);
  }, [route.hash, route.params, state.activeProjectId, state.projects]);

  const counts: Partial<Record<RouteName, number>> = { records: openProposals, questions: openQuestions, reports: pendingReports };

  const exportSession = () => {
    const blob = new Blob([store.exportSession()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bakara-demo-session-${state.clock.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="app">
      <nav className="app-nav" aria-label="ניווט ראשי">
        <div className="brand">
          <div className="brand-mark">
            <span className="mark" aria-hidden="true">
              {branding.productName.slice(0, 1)}
            </span>
            <span className="name">{branding.productName}</span>
          </div>
          <div className="brand-tagline">{branding.tagline}</div>
        </div>
        <ul className="nav-list">
          {NAV.map((item) => (
            <li key={item.name}>
              <a className={`nav-link${route.name === item.name ? " active" : ""}`} href={routeWith(item.name, item.name === "budget" || item.name === "reports" ? { project: state.activeProjectId } : {})} aria-current={route.name === item.name ? "page" : undefined}>
                <span>{item.labelHe}</span>
                {counts[item.name] ? <span className="count">{counts[item.name]}</span> : null}
              </a>
            </li>
          ))}
        </ul>
        <div className="nav-footer">
          <span className="demo-badge">● {branding.demoBadge}</span>
          <span>
            {he.status.autoAnalysis}
            {analyzing ? " · בבדיקה…" : ""}
          </span>
          <span>
            {state.company.nameHe} · {state.company.descriptionHe}
          </span>
        </div>
      </nav>

      <header className="app-header">
        <label className="row small muted" style={{ gap: 6 }}>
          <span>פרויקט</span>
          <select className="select" value={state.activeProjectId} onChange={(e) => navigate(routeWith(route.name, { ...Object.fromEntries(route.params), project: e.target.value }))} aria-label="בחירת פרויקט">
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameHe}
                {p.status === "draft" ? " (טיוטת תקציב)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="role-switch" role="group" aria-label={he.roles.switchLabel} title={he.roles.transitionLabel}>
          <button type="button" aria-pressed={state.role === "manager"} onClick={() => store.setRole("manager")}>
            {he.roles.manager}
          </button>
          <button type="button" className="reviewer" aria-pressed={state.role === "reviewer"} onClick={() => store.setRole("reviewer")}>
            {he.roles.reviewer}
          </button>
        </div>
        {state.role === "reviewer" ? <Badge tone="navy">{he.roles.transitionLabel}</Badge> : null}
        <div className="header-spacer" />
        <div className="clock" title="השעון המדומה של ההדגמה, Asia/Jerusalem">
          <span>🕘</span>
          <Bidi>{formatDateTime(state.clock)}</Bidi>
          {mode === "scenario" && scenario ? <Badge tone="primary">תרחיש {scenario.number}</Badge> : <Badge tone="neutral">מרחב חופשי</Badge>}
        </div>
        <Button size="sm" variant="primary" guide="advance-week" onClick={() => store.dispatch((s) => advanceDemoClock(s, 7), "השעון התקדם בשבוע; דוחות מתוזמנים הוכנו לבדיקה")}>
          {he.actions.advanceWeek}
        </Button>
        <Button size="sm" onClick={() => setPresenterOpen((v) => !v)} aria-expanded={presenterOpen}>
          בקרת הצגה
        </Button>
      </header>

      <main className="app-main">
        <GuidePanel />
        {incompatibleStorage ? (
          <div style={{ marginBottom: 16 }}>
            <Notice tone="amber">
              נמצאו נתוני הדגמה שמורים מגרסה קודמת שאינה תואמת.{" "}
              <Button size="sm" variant="primary" onClick={() => store.resetDemo()}>
                {he.actions.loadNewSeed}
              </Button>
            </Notice>
          </div>
        ) : null}
        {presenterOpen ? (
          <div className="presenter-bar" data-guide="presenter-bar">
            <span className="label">בקרת הצגה:</span>
            <Button size="sm" onClick={() => store.startTour()}>
              {he.actions.tryGuided}
            </Button>
            <Button size="sm" onClick={() => navigate("#/scenarios")}>
              {he.actions.showScenarios}
            </Button>
            {mode === "scenario" ? (
              <>
                <Button size="sm" onClick={() => store.restartScenario()}>
                  {he.actions.restartScenario}
                </Button>
                <Button size="sm" onClick={() => store.exitToWorkspace()}>
                  {he.actions.backToWorkspace}
                </Button>
              </>
            ) : null}
            <Chip active={ui.skipMotion} onClick={() => store.setUi({ skipMotion: !ui.skipMotion })}>
              {he.actions.skipMotion}
            </Chip>
            <Button size="sm" variant="ghost" onClick={exportSession}>
              ייצוא הפעלה (JSON)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
              ייבוא הפעלה
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                file.text().then((text) => {
                  try {
                    store.importSession(text);
                  } catch (err) {
                    store.toast(err instanceof Error ? err.message : "קובץ לא תקין", "error");
                  }
                });
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="danger" onClick={() => setConfirmReset(true)}>
              {he.actions.resetAll}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => uiCtx.open({ kind: "pilot" })}>
              {he.actions.pilotInvite}
            </Button>
          </div>
        ) : null}
        <Page name={route.name} />
      </main>

      <DrawerHost />
      <Toasts />
      {confirmReset ? (
        <Surface
          kind="modal"
          title="לאפס את נתוני ההדגמה?"
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <Button
                variant="danger"
                onClick={() => {
                  store.resetDemo();
                  setConfirmReset(false);
                  navigate("#/overview");
                }}
              >
                אפס הכול
              </Button>
              <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                ביטול
              </Button>
            </>
          }
        >
          <p>כל התנועות, התחזיות, ההודעות, ההנחיות, הדוחות והתקדמות התרחישים יחזרו למצב הפתיחה הקנוני. פעולה זו אינה ניתנת לביטול.</p>
        </Surface>
      ) : null}
    </div>
  );
}

export function App() {
  return (
    <UiProvider>
      <Shell />
    </UiProvider>
  );
}
