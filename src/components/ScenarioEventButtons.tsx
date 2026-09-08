import { store, useDemo } from "../app/store";
import type { RouteName } from "../app/router";
import { Badge, Button } from "./primitives";

/** Triggers of the active scenario placed in context (e.g. inside the relevant cost code). */
export function ScenarioEventButtons({ route, costCodeId, recordId, compact }: { route: RouteName; costCodeId?: string; recordId?: string; compact?: boolean }) {
  const { state, scenario } = useDemo();
  if (!scenario || !state.scenario) return null;
  const events = scenario.events.filter((e) => {
    if (!e.route) return false;
    if (!e.route.startsWith(`#/${route}`)) return false;
    if (costCodeId && !e.route.includes(`code=${costCodeId}`)) return false;
    if (!costCodeId && route === "budget" && e.route.includes("code=")) return false;
    if (recordId && !e.route.includes(`record=${recordId}`)) return false;
    if (e.role && e.role !== state.role) return false;
    return true;
  });
  if (events.length === 0) return null;
  const received = state.scenario.receivedEventIds;
  return (
    <div className="scenario-events" data-guide="scenario-events">
      {!compact ? <span className="label">תרחיש {scenario.number}:</span> : null}
      {events.map((e) => {
        const done = e.doneWhen ? e.doneWhen(state) : received.includes(e.id);
        const available = e.availableWhen ? e.availableWhen(state) : true;
        return (
          <span key={e.id} className="row" title={e.descriptionHe}>
            <Button size="sm" variant={e.kind === "primary" ? "primary" : "secondary"} done={done} disabled={!available && !done} onClick={() => store.receiveScenarioEvent(e.id)}>
              {done ? "✓ " : ""}
              {e.labelHe}
            </Button>
            {e.kind === "branch" ? <Badge tone="neutral">ענף</Badge> : null}
          </span>
        );
      })}
    </div>
  );
}
