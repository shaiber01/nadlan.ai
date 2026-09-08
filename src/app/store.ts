import { useSyncExternalStore } from "react";
import { scenarioById, scenarios } from "../data/scenarios/definitions";
import { tourSegments } from "../data/scenarios/tour";
import type { ScenarioDefinition } from "../data/scenarios/types";
import { SEED_VERSION } from "../data/seed";
import { completeAnalysis } from "../domain/commands/core";
import { addActivity, bump } from "../domain/state-utils";
import type { DemoState, Role } from "../domain/types";
import { createDemoState, newSessionId } from "./demo";

/**
 * Application store: one active DemoState (free-exploration workspace or an isolated scenario session),
 * localStorage persistence keyed by seed version, and the automatic-analysis scheduler
 * (short simulated delay, results discarded when the session changed).
 */

const STORAGE_KEY = "bakara-demo-v1";
const ANALYSIS_DELAY_MS = [250, 700];

export type Mode = "workspace" | "scenario";

export interface TourProgress {
  index: number;
}

interface Persisted {
  version: 1;
  seedVersion: string;
  mode: Mode;
  workspace: DemoState;
  scenarioState: DemoState | null;
  savedWorkspace: DemoState | null;
  tour: TourProgress | null;
  ui: UiPrefs;
}

export interface UiPrefs {
  skipMotion: boolean;
  compactGuide: boolean;
}

export interface Toast {
  id: number;
  textHe: string;
  kind: "info" | "error" | "success";
}

export interface AppSnapshot {
  state: DemoState;
  mode: Mode;
  scenario: ScenarioDefinition | null;
  tour: TourProgress | null;
  ui: UiPrefs;
  toasts: Toast[];
  incompatibleStorage: boolean;
  analyzing: boolean;
}

type Listener = () => void;

export class DemoStore {
  private state: DemoState;
  private savedWorkspace: DemoState | null = null;
  private mode: Mode = "workspace";
  private tour: TourProgress | null = null;
  private ui: UiPrefs = { skipMotion: false, compactGuide: false };
  private toasts: Toast[] = [];
  private incompatibleStorage = false;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: AppSnapshot;
  private toastSeq = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const loaded = this.load();
    if (loaded) {
      this.state = loaded.mode === "scenario" && loaded.scenarioState ? loaded.scenarioState : loaded.workspace;
      this.savedWorkspace = loaded.mode === "scenario" ? loaded.savedWorkspace ?? loaded.workspace : null;
      this.mode = loaded.mode;
      this.tour = loaded.tour;
      this.ui = loaded.ui;
    } else {
      this.state = createDemoState(newSessionId("ws"));
    }
    this.snapshot = this.buildSnapshot();
    this.scheduleAnalysisTick();
  }

  private load(): Persisted | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Persisted;
      if (parsed.version !== 1 || parsed.seedVersion !== SEED_VERSION || !parsed.workspace?.projects) {
        this.incompatibleStorage = true;
        return null;
      }
      return parsed;
    } catch {
      this.incompatibleStorage = true;
      return null;
    }
  }

  private persist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        const data: Persisted = {
          version: 1,
          seedVersion: SEED_VERSION,
          mode: this.mode,
          workspace: this.mode === "workspace" ? this.state : (this.savedWorkspace ?? this.state),
          scenarioState: this.mode === "scenario" ? this.state : null,
          savedWorkspace: this.savedWorkspace,
          tour: this.tour,
          ui: this.ui,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        /* storage may be unavailable; the demo still works in memory */
      }
    }, 150);
  }

  private buildSnapshot(): AppSnapshot {
    return {
      state: this.state,
      mode: this.mode,
      scenario: this.state.activeScenarioId ? scenarioById(this.state.activeScenarioId) : null,
      tour: this.tour,
      ui: this.ui,
      toasts: this.toasts,
      incompatibleStorage: this.incompatibleStorage,
      analyzing: this.state.pendingAnalyses.length > 0,
    };
  }

  private emit() {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
    this.persist();
    this.scheduleAnalysisTick();
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /** Apply a pure command; errors surface as Hebrew toasts and leave state unchanged. */
  dispatch(command: (state: DemoState) => DemoState, successHe?: string): boolean {
    try {
      const next = command(this.state);
      if (next !== this.state) {
        this.state = next;
      }
      if (successHe) this.toast(successHe, "success");
      this.emit();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.toast(message, "error");
      this.emit();
      return false;
    }
  }

  toast(textHe: string, kind: Toast["kind"] = "info") {
    const id = ++this.toastSeq;
    this.toasts = [...this.toasts, { id, textHe, kind }];
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.emit();
    }, kind === "error" ? 6000 : 3500);
  }

  dismissToast(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  private scheduleAnalysisTick() {
    if (this.timer || this.state.pendingAnalyses.length === 0) return;
    const pending = this.state.pendingAnalyses[0];
    const sessionId = this.state.sessionId;
    const delay = this.ui.skipMotion ? 0 : ANALYSIS_DELAY_MS[0] + Math.floor(Math.random() * (ANALYSIS_DELAY_MS[1] - ANALYSIS_DELAY_MS[0]));
    this.timer = setTimeout(() => {
      this.timer = null;
      // Results that belong to a previous session (reset/scenario change) are discarded by the command itself.
      this.state = completeAnalysis(this.state, pending.id, sessionId);
      this.emit();
    }, delay);
  }

  setRole(role: Role) {
    this.state = { ...this.state, role };
    this.emit();
  }

  setActiveProject(projectId: string) {
    this.state = { ...this.state, activeProjectId: projectId, chat: { ...this.state.chat, scope: { ...this.state.chat.scope, projectId, portfolio: false }, lastContext: { projectId, costCodeId: null } } };
    this.emit();
  }

  setUi(patch: Partial<UiPrefs>) {
    this.ui = { ...this.ui, ...patch };
    this.state = { ...this.state, flags: { ...this.state.flags, skipMotion: this.ui.skipMotion } };
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Scenario sessions
  // ---------------------------------------------------------------------------

  loadScenario(scenarioId: string, options: { tourIndex?: number | null } = {}) {
    const def = scenarioById(scenarioId);
    if (this.mode === "workspace") this.savedWorkspace = this.state;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    let s = def.buildFixture(newSessionId(def.id));
    s = { ...s, role: this.state.role, flags: { ...s.flags, skipMotion: this.ui.skipMotion }, activeScenarioId: def.id, scenario: { scenarioId: def.id, receivedEventIds: [], stepIndex: 0, guidanceHidden: false, startedAt: s.clock, tourStepIndex: options.tourIndex ?? null, seededHistoryHe: def.seededHistoryHe ?? [] } };
    s = addActivity(s, "scenario", `נטען מצב פתיחה לתרחיש ${def.number}: ${def.titleHe}`, []);
    this.state = bump(s);
    this.mode = "scenario";
    if (options.tourIndex != null) this.tour = { index: options.tourIndex };
    else this.tour = null;
    this.toast(`נטען מצב פתיחה לתרחיש ${def.number}`, "info");
    this.emit();
  }

  /** Continue a scenario's guidance on the current state (tour carry-forward). Falls back to loading the fixture. */
  continueScenario(scenarioId: string, tourIndex: number | null) {
    const def = scenarioById(scenarioId);
    const canContinue = def.canContinueFrom ? def.canContinueFrom(this.state) : false;
    if (!canContinue || this.mode !== "scenario") {
      this.loadScenario(scenarioId, { tourIndex });
      return;
    }
    let s: DemoState = { ...this.state, activeScenarioId: def.id, activeProjectId: def.activeProjectId, scenario: { scenarioId: def.id, receivedEventIds: this.state.scenario?.receivedEventIds ?? [], stepIndex: 0, guidanceHidden: false, startedAt: this.state.clock, tourStepIndex: tourIndex, seededHistoryHe: [] } };
    if (def.clock && def.clock > s.clock) s = { ...s, clock: def.clock };
    s = addActivity(s, "scenario", `ממשיכים לתרחיש ${def.number} על המצב הנוכחי: ${def.titleHe}`, []);
    this.state = bump(s);
    this.tour = tourIndex != null ? { index: tourIndex } : null;
    this.emit();
  }

  restartScenario() {
    if (!this.state.activeScenarioId) return;
    const tourIndex = this.tour?.index ?? null;
    this.loadScenario(this.state.activeScenarioId, { tourIndex });
  }

  exitToWorkspace() {
    if (this.mode !== "scenario") return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const restored = this.savedWorkspace ?? createDemoState(newSessionId("ws"));
    this.state = { ...restored, role: this.state.role, flags: { ...restored.flags, skipMotion: this.ui.skipMotion } };
    this.savedWorkspace = null;
    this.mode = "workspace";
    this.tour = null;
    this.toast("חזרה למרחב החופשי: הניסויים שלך שוחזרו", "info");
    this.emit();
  }

  /** Hide guidance but keep the scenario state; free navigation is allowed. */
  setGuidanceHidden(hidden: boolean) {
    if (!this.state.scenario) return;
    this.state = { ...this.state, scenario: { ...this.state.scenario, guidanceHidden: hidden } };
    this.emit();
  }

  setStep(index: number) {
    if (!this.state.scenario) return;
    const def = scenarioById(this.state.scenario.scenarioId);
    const clamped = Math.max(0, Math.min(def.steps.length - 1, index));
    this.state = { ...this.state, scenario: { ...this.state.scenario, stepIndex: clamped } };
    this.emit();
  }

  receiveScenarioEvent(eventId: string) {
    const scenario = this.state.scenario;
    if (!scenario) return;
    const def = scenarioById(scenario.scenarioId);
    const event = def.events.find((e) => e.id === eventId);
    if (!event) return;
    if (scenario.receivedEventIds.includes(eventId) && event.kind !== "optional") {
      this.toast("האירוע כבר התקבל בתרחיש זה", "info");
      return;
    }
    if (event.availableWhen && !event.availableWhen(this.state)) {
      this.toast("האירוע אינו זמין במצב הנוכחי", "info");
      return;
    }
    this.dispatch((s) => {
      const next = event.apply(s);
      return { ...next, scenario: next.scenario ? { ...next.scenario, receivedEventIds: [...next.scenario.receivedEventIds, eventId] } : next.scenario };
    });
  }

  resetDemo() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const base = createDemoState(newSessionId("ws"));
    this.state = { ...base, flags: { ...base.flags, skipMotion: this.ui.skipMotion } };
    this.savedWorkspace = null;
    this.mode = "workspace";
    this.tour = null;
    this.incompatibleStorage = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.toast("נתוני ההדגמה אופסו למצב הפתיחה", "success");
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Guided tour
  // ---------------------------------------------------------------------------

  startTour() {
    const first = tourSegments[0];
    this.loadScenario(first.scenarioId, { tourIndex: 0 });
  }

  nextTourSegment() {
    if (!this.tour) return;
    const nextIndex = this.tour.index + 1;
    if (nextIndex >= tourSegments.length) {
      this.tour = { index: nextIndex };
      this.state = { ...this.state, scenario: this.state.scenario ? { ...this.state.scenario, guidanceHidden: true } : null };
      this.emit();
      return;
    }
    const segment = tourSegments[nextIndex];
    if (segment.mode === "load") this.loadScenario(segment.scenarioId, { tourIndex: nextIndex });
    else this.continueScenario(segment.scenarioId, nextIndex);
  }

  endTour() {
    this.tour = null;
    this.emit();
  }

  exportSession(): string {
    return JSON.stringify({ version: 1, seedVersion: SEED_VERSION, mode: this.mode, state: this.state, savedWorkspace: this.savedWorkspace }, null, 0);
  }

  importSession(json: string) {
    const parsed = JSON.parse(json) as { seedVersion: string; mode: Mode; state: DemoState; savedWorkspace: DemoState | null };
    if (parsed.seedVersion !== SEED_VERSION || !parsed.state?.projects) throw new Error("קובץ ההפעלה אינו תואם לגרסת הנתונים הנוכחית");
    this.state = parsed.state;
    this.mode = parsed.mode;
    this.savedWorkspace = parsed.savedWorkspace;
    this.tour = null;
    this.toast("הפעלת ההדגמה נטענה מהקובץ", "success");
    this.emit();
  }
}

export const store = new DemoStore();

export function useDemo(): AppSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useDemoState(): DemoState {
  return useDemo().state;
}

export const allScenarios = scenarios;
