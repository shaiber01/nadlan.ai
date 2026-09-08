import { navigate } from "../../app/router";
import { allScenarios, store, useDemo } from "../../app/store";
import { useUi } from "../../app/ui";
import { Badge, Button, Notice, PageHeader } from "../../components/primitives";
import { tourIntroHe, tourSegments } from "../../data/scenarios/tour";
import type { ScenarioDefinition, ScenarioEvent } from "../../data/scenarios/types";
import { he } from "../../locales/he";
import "./scenarios.css";

const eventKindHe: Record<ScenarioEvent["kind"], string> = { primary: "ראשי", branch: "ענף", optional: "אופציונלי" };

function durationHe(seconds: number): string {
  if (seconds < 60) return `כ-${seconds} שניות`;
  const minutes = seconds / 60;
  if (minutes <= 1.1) return "כדקה";
  if (minutes <= 1.3) return "כדקה ורבע";
  if (minutes <= 1.6) return "כדקה וחצי";
  if (minutes <= 2.2) return "כשתי דקות";
  return `כ-${Math.round(minutes)} דקות`;
}

const exploreItemsHe: { labelHe: string; route: string }[] = [
  { labelHe: "לעבור בין פרויקטים וסעיפי תקציב ולפתוח כל מקור", route: "#/budget" },
  { labelHe: "לסנן תנועות לפי סטטוס, סעיף, פרויקט וספק", route: "#/records" },
  { labelHe: "לערוך את רכישת הברזל לדוגמה (כמות ומחיר) בטופס מוגבל ומאומת", route: "#/budget?project=HAD&code=H10" },
  { labelHe: "להשוות מחירי ברזל עתידיים חלופיים", route: "#/budget?project=HAD&code=H10" },
  { labelHe: "לענות תשובת חלוקה משלכם בשיחת ה-WhatsApp", route: "#/questions?tab=messages" },
  { labelHe: "לאשר או לדחות הצעת תיקון", route: "#/records?tab=proposals" },
  { labelHe: "לאשר שינוי תחזית אחרי בדיקת ההנחות שלו", route: "#/records?tab=proposals" },
  { labelHe: "לשנות את פריסת הדוח וערוץ המסירה", route: "#/reports" },
  { labelHe: "להפיק דוח, לפתוח את הקובץ המצורף ולעיין בדוח קודם", route: "#/reports" },
  { labelHe: "לשאול שאלות בטקסט חופשי, לא רק מהצעות", route: "#/chat" },
  { labelHe: "לבחון ולהפעיל מחדש כל תרחיש בנפרד", route: "#/scenarios" },
];

export function ScenariosPage() {
  const { state, mode, scenario } = useDemo();
  const ui = useUi();
  const totalSeconds = tourSegments.reduce((acc, s) => acc + s.approxSeconds, 0);
  const progress = state.scenario;

  const start = (def: ScenarioDefinition) => {
    store.loadScenario(def.id);
    const first = def.steps[0];
    navigate(first ? first.route : "#/overview");
  };

  const openGuidance = (def: ScenarioDefinition) => {
    store.setGuidanceHidden(false);
    const step = def.steps[progress?.stepIndex ?? 0] ?? def.steps[0];
    if (step) navigate(step.route);
  };

  return (
    <div className="stack-lg">
      <PageHeader title={he.nav.scenarios} subtitle={he.general.scenarioGalleryIntro} />

      <section className="card stack">
        <div className="card-title">
          <h3>הדגמה מודרכת (8–10 דקות)</h3>
          <Badge tone="neutral">סה״כ {durationHe(totalSeconds)} של פעולות מציג</Badge>
        </div>
        <p className="small">{tourIntroHe}</p>
        <div className="table-wrap">
          <table className="table compact tour-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>תרחיש</th>
                <th>זמן משוער</th>
                <th>פעולת המציג</th>
                <th>מה לומדים</th>
              </tr>
            </thead>
            <tbody>
              {tourSegments.map((segment, i) => {
                const def = allScenarios.find((s) => s.id === segment.scenarioId);
                return (
                  <tr key={`${segment.scenarioId}-${i}`}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <div className="row">
                        <span>
                          {def ? `${def.number}. ${def.titleHe}` : segment.scenarioId}
                        </span>
                        <Badge tone={segment.mode === "load" ? "navy" : "neutral"}>{segment.mode === "load" ? "טוען מצב פתיחה" : "ממשיך על המצב הנוכחי"}</Badge>
                      </div>
                    </td>
                    <td className="small nowrap">{durationHe(segment.approxSeconds)}</td>
                    <td className="small">{segment.presenterHe}</td>
                    <td className="small muted">{segment.takeawayHe}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row">
          <Button variant="primary" size="lg" onClick={() => store.startTour()}>
            {he.actions.tryGuided}
          </Button>
          <Button onClick={() => ui.open({ kind: "pilot" })}>{he.actions.pilotInvite}</Button>
          <span className="tiny muted">ההדרכה מציגה רמזים ליד הפקד הרלוונטי ואינה לוחצת על אישורים במקום המציג.</span>
        </div>
      </section>

      {mode === "scenario" && scenario ? (
        <Notice tone="navy">
          <div className="stack-sm">
            <div>
              תרחיש פעיל: {scenario.number}. {scenario.titleHe}
              {scenario.isComplete(state) ? " — הושלם" : ""}. המרחב החופשי נשמר וישוחזר כשתחזרו אליו; ניסויים שעשיתם לא ייעלמו.
            </div>
            <div className="row">
              <Button size="sm" onClick={() => store.restartScenario()}>
                {he.actions.restartScenario}
              </Button>
              <Button size="sm" onClick={() => openGuidance(scenario)}>
                {he.actions.showGuidance}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => store.exitToWorkspace()}>
                {he.actions.backToWorkspace}
              </Button>
            </div>
          </div>
        </Notice>
      ) : null}

      <Notice tone="amber">
        כל תרחיש נטען עם מצב פתיחה משלו ומבודד מהאחרים: מסמכים ותשובות של ענפים אחרים אינם זמינים בו. המרחב החופשי נשמר בנפרד ומשוחזר ביציאה. תרחיש 15 מתחיל אחרי השלמת תרחיש 5 ותרחיש 16 אחרי השלמת תרחיש 6 (היסטוריה שנטענת מראש ומסומנת ככזו).
      </Notice>

      <div className="scenario-grid">
        {allScenarios.map((def) => {
          const active = scenario?.id === def.id;
          const complete = active && def.isComplete(state);
          return (
            <section key={def.id} className={`card scenario-card${active ? " selected" : ""}`} aria-label={`תרחיש ${def.number}: ${def.titleHe}`}>
              <div className="row-between">
                <div className="row">
                  {active ? (
                    <Badge tone="primary" dot>
                      פעיל
                    </Badge>
                  ) : (
                    <Badge tone="neutral">לא הופעל</Badge>
                  )}
                  {complete ? (
                    <Badge tone="green" dot>
                      הושלם
                    </Badge>
                  ) : null}
                </div>
                <span className="tiny faint">{def.activeProjectId === "NOF" ? "נוף הגבעה (טיוטה)" : state.projects.find((p) => p.id === def.activeProjectId)?.nameHe}</span>
              </div>
              <h3>
                <span className="scenario-number" aria-hidden="true">
                  {def.number}
                </span>
                <span>{def.titleHe}</span>
              </h3>
              <p className="small">{def.purposeHe}</p>
              <div className="small muted">
                <span className="strong">מצב פתיחה:</span> {def.fixtureHe}
              </div>
              {def.seededHistoryHe?.length ? (
                <div className="small muted">
                  <span className="strong">היסטוריה שנטענת מראש:</span> {def.seededHistoryHe.join("; ")}
                </div>
              ) : null}
              {def.events.length > 0 ? (
                <div className="pill-list">
                  {def.events.map((e) => (
                    <span key={e.id} className="badge badge-neutral" title={e.descriptionHe}>
                      {e.labelHe} · {eventKindHe[e.kind]}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="tiny muted">התרחיש פועל דרך פעולות המסך הרגילות; ההדרכה מכוונת אליהן.</span>
              )}
              <details>
                <summary>מה רואים</summary>
                <ul>
                  {def.expectationsHe.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </details>
              <div className="scenario-actions">
                <Button variant={active ? "secondary" : "primary"} size="sm" onClick={() => start(def)}>
                  {active ? he.actions.restartScenario : he.actions.startScenario}
                </Button>
                {active ? (
                  <Button size="sm" variant="ghost" onClick={() => openGuidance(def)}>
                    פתח הדרכה
                  </Button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      <section className="card stack-sm">
        <div className="card-title">
          <h3>חקירה חופשית</h3>
          <span className="tiny muted">אינטראקציה אמיתית על אותם נתונים משותפים, בלי לעקוב אחרי מצגת</span>
        </div>
        <ul className="explore-list">
          {exploreItemsHe.map((item) => (
            <li key={item.labelHe}>
              <span>{item.labelHe}</span>
              <Button size="sm" variant="ghost" onClick={() => navigate(item.route)}>
                {he.actions.open}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
