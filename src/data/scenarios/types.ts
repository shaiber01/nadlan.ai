import type { DemoState, Role } from "../../domain/types";

export interface ScenarioEvent {
  id: string;
  labelHe: string;
  descriptionHe?: string;
  kind: "primary" | "branch" | "optional";
  /** Route where the trigger also appears in context (the scenario panel always lists it). */
  route?: string;
  apply: (state: DemoState) => DemoState;
  availableWhen?: (state: DemoState) => boolean;
  doneWhen?: (state: DemoState) => boolean;
  /** Presenter role required to see the control */
  role?: Role;
}

export interface GuidanceStep {
  id: string;
  textHe: string;
  route: string;
  anchor?: string;
  role?: Role;
  doneWhen?: (state: DemoState) => boolean;
}

export interface ScenarioDefinition {
  id: string;
  number: number;
  titleHe: string;
  purposeHe: string;
  summaryHe: string;
  activeProjectId: string;
  /** Starting clock for the fixture (default: canonical). */
  clock?: string;
  buildFixture: (sessionId: string) => DemoState;
  /** Can the scenario continue on the current (tour) state? If it returns false the fixture is loaded. */
  canContinueFrom?: (state: DemoState) => boolean;
  events: ScenarioEvent[];
  steps: GuidanceStep[];
  isComplete: (state: DemoState) => boolean;
  expectationsHe: string[];
  seededHistoryHe?: string[];
  /** Hebrew line describing the starting fixture. */
  fixtureHe: string;
}
