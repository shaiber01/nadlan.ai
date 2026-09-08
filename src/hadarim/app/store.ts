import { useSyncExternalStore } from "react";
import { initialState, revealAllSteps, revealNextStep } from "../engine/commands";
import type { V2State } from "../engine/model";

/**
 * Tiny external store for the Hadarim v2 demo: one persisted domain state (`V2State`) and one
 * persisted UI state. Commands are pure functions applied through `dispatch`.
 */

export type ErpScreen = "invoices" | "purchase_orders" | "contracts" | "budget" | "change_log";

export interface UiState {
  app: "erp" | "control";
  erp: { screen: ErpScreen; invoiceId: number | null; editing: boolean; creating: boolean; poId: number | null; contractId: string | null; sectionId: string | null };
  control: { pane: "chat" | "report"; reportTab: "full" | "ceo"; documentId: string | null; documentAnchor: string | null; recordRef: { type: "invoice" | "po" | "contract"; id: string } | null };
  presenter: { skipMotion: boolean; showPresenterBar: boolean; scene1Variant: "A" | "B" };
}

const STATE_KEY = "hadarim-v2";
const UI_KEY = "hadarim-v2-ui";

export const defaultUi: UiState = {
  app: "erp",
  erp: { screen: "invoices", invoiceId: null, editing: false, creating: false, poId: null, contractId: null, sectionId: null },
  control: { pane: "chat", reportTab: "full", documentId: null, documentAnchor: null, recordRef: null },
  presenter: { skipMotion: false, showPresenterBar: true, scene1Variant: "A" },
};

function load<T>(key: string, fallback: () => T, validate: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback();
    const parsed = JSON.parse(raw);
    return validate(parsed) ? (parsed as T) : fallback();
  } catch {
    return fallback();
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, quota) — the demo keeps running in memory */
  }
}

class HadarimStore {
  private state: V2State;
  private ui: UiState;
  private listeners = new Set<() => void>();
  private stepTimer: number | null = null;

  constructor() {
    this.state = load(STATE_KEY, initialState, (v) => !!v && typeof v === "object" && (v as V2State).version === 1 && Array.isArray((v as V2State).erp?.invoices));
    this.ui = { ...defaultUi, ...load(UI_KEY, () => defaultUi, (v) => !!v && typeof v === "object" && "app" in (v as object)) };
  }

  getState = (): V2State => this.state;
  getUi = (): UiState => this.ui;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Apply a pure command. Errors propagate to the caller (the UI shows them inline). */
  dispatch = (command: (s: V2State) => V2State): void => {
    const next = command(this.state);
    if (next === this.state) return;
    this.state = next;
    save(STATE_KEY, next);
    this.emit();
  };

  setUi = (patch: Partial<UiState> | ((u: UiState) => UiState)): void => {
    this.ui = typeof patch === "function" ? patch(this.ui) : { ...this.ui, ...patch };
    save(UI_KEY, this.ui);
    this.emit();
  };

  go = (app: UiState["app"]): void => this.setUi((u) => ({ ...u, app }));

  openDocument = (documentId: string, anchor?: string): void => this.setUi((u) => ({ ...u, control: { ...u.control, documentId, documentAnchor: anchor ?? null } }));

  closeDocument = (): void => this.setUi((u) => ({ ...u, control: { ...u.control, documentId: null, documentAnchor: null } }));

  openRecord = (recordRef: UiState["control"]["recordRef"]): void => this.setUi((u) => ({ ...u, control: { ...u.control, recordRef } }));

  /** Reveal the control's data-gathering steps one by one (or all at once when motion is skipped). */
  playSteps = (): void => {
    this.stopSteps();
    if (this.ui.presenter.skipMotion) {
      this.dispatch(revealAllSteps);
      return;
    }
    const step = () => {
      const before = this.state;
      this.dispatch(revealNextStep);
      const done = this.state === before || this.state.control.messages.find((m) => m.kind === "steps")?.steps?.every((st) => st.done);
      if (done) this.stopSteps();
      else this.stepTimer = window.setTimeout(step, 650);
    };
    this.stepTimer = window.setTimeout(step, 400);
  };

  stopSteps = (): void => {
    if (this.stepTimer != null) window.clearTimeout(this.stepTimer);
    this.stepTimer = null;
  };

  reset = (): void => {
    this.stopSteps();
    this.state = initialState();
    this.ui = { ...defaultUi, presenter: this.ui.presenter };
    save(STATE_KEY, this.state);
    save(UI_KEY, this.ui);
    this.emit();
  };
}

export const store = new HadarimStore();

export function useV2State(): V2State {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function useUi(): UiState {
  return useSyncExternalStore(store.subscribe, store.getUi, store.getUi);
}

declare global {
  interface Window {
    __hadarimStore?: HadarimStore;
  }
}
if (typeof window !== "undefined") window.__hadarimStore = store;
