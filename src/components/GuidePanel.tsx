import { useEffect, useRef } from "react";
import { navigate } from "../app/router";
import { store, useDemo } from "../app/store";
import { tourIntroHe, tourOutroHe, tourSegments } from "../data/scenarios/tour";
import { Button } from "./primitives";

/** Floating Hebrew guidance for the active scenario or the guided tour. Never clicks approvals for the presenter. */
export function GuidePanel() {
  const { state, scenario, tour } = useDemo();
  const progress = state.scenario;
  const lastStepKey = useRef<string>("");

  const step = scenario && progress ? scenario.steps[progress.stepIndex] : undefined;
  const stepKey = `${scenario?.id}:${progress?.stepIndex}`;

  useEffect(() => {
    if (!scenario || !progress || !step || progress.guidanceHidden) return;
    if (lastStepKey.current === stepKey) return;
    lastStepKey.current = stepKey;
    if (step.role && step.role !== state.role) store.setRole(step.role);
    navigate(step.route);
  }, [scenario, progress, step, stepKey, state.role]);

  useEffect(() => {
    if (!step?.anchor || progress?.guidanceHidden) return;
    const timer = setTimeout(() => {
      document.querySelectorAll("[data-guide-active]").forEach((el) => el.removeAttribute("data-guide-active"));
      const el = document.querySelector<HTMLElement>(`[data-guide="${step.anchor}"]`);
      if (el) {
        el.setAttribute("data-guide-active", "true");
        el.scrollIntoView({ block: "center", behavior: state.flags.skipMotion ? "auto" : "smooth" });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      document.querySelectorAll("[data-guide-active]").forEach((el) => el.removeAttribute("data-guide-active"));
    };
  }, [step, progress?.guidanceHidden, state.revision, state.flags.skipMotion]);

  if (!scenario || !progress) return null;
  if (progress.guidanceHidden) {
    return (
      <div className="guide" style={{ padding: "8px 12px" }}>
        <div className="row-between">
          <span className="small">תרחיש {scenario.number} · ההדרכה מוסתרת</span>
          <div className="row">
            <Button size="sm" variant="ghost" onClick={() => store.setGuidanceHidden(false)}>
              הצג הדרכה
            </Button>
            <Button size="sm" variant="ghost" onClick={() => store.exitToWorkspace()}>
              חזרה למרחב החופשי
            </Button>
          </div>
        </div>
      </div>
    );
  }
  const total = scenario.steps.length;
  const done = step?.doneWhen ? step.doneWhen(state) : false;
  const complete = scenario.isComplete(state);
  const isLast = progress.stepIndex >= total - 1;
  const inTour = tour != null;
  const tourFinished = inTour && tour.index >= tourSegments.length;
  const segment = inTour && !tourFinished ? tourSegments[tour.index] : null;

  return (
    <aside className="guide" aria-label="הדרכה">
      <div className="guide-title">
        <span>
          {inTour ? `הדגמה מודרכת ${Math.min(tour.index + 1, tourSegments.length)}/${tourSegments.length} · ` : ""}תרחיש {scenario.number}: {scenario.titleHe}
        </span>
        <span>
          שלב {progress.stepIndex + 1}/{total}
        </span>
      </div>
      {inTour && tour.index === 0 && progress.stepIndex === 0 ? <div className="small" style={{ opacity: 0.85 }}>{tourIntroHe}</div> : null}
      {segment ? <div className="tiny" style={{ opacity: 0.75 }}>{segment.presenterHe} — {segment.takeawayHe}</div> : null}
      <div className="guide-text">{tourFinished ? tourOutroHe : step?.textHe}</div>
      {done ? <div className="small" style={{ color: "#2dd4bf" }}>✓ השלב הושלם לפי נתוני המערכת</div> : null}
      {complete ? <div className="small" style={{ color: "#2dd4bf" }}>✓ התרחיש הושלם — אפשר להמשיך לחקור או להפעיל מחדש</div> : null}
      <div className="row">
        <Button size="sm" variant="secondary" disabled={progress.stepIndex === 0} onClick={() => store.setStep(progress.stepIndex - 1)}>
          הקודם
        </Button>
        {!isLast ? (
          <Button size="sm" variant={complete ? "secondary" : "primary"} onClick={() => store.setStep(progress.stepIndex + 1)}>
            הבא
          </Button>
        ) : null}
        {inTour && !tourFinished && (isLast || complete) ? (
          <Button size="sm" variant="primary" onClick={() => store.nextTourSegment()}>
            המשך לתרחיש הבא
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => store.setGuidanceHidden(true)}>
          הסתר הדרכה
        </Button>
        <Button size="sm" variant="ghost" onClick={() => store.restartScenario()}>
          התחל מחדש
        </Button>
        <Button size="sm" variant="ghost" onClick={() => store.exitToWorkspace()}>
          מעבר לחקירה חופשית
        </Button>
        {inTour && !tourFinished ? (
          <Button size="sm" variant="ghost" onClick={() => navigate("#/scenarios")}>
            הצג תרחישים
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
