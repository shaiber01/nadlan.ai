import { useSyncExternalStore } from "react";
import type { HInvoice, HPurchaseOrder } from "../data/types";
import { deleteInvoice, loadErp, loadPackage, resetProject, saveInvoice, savePurchaseOrder, subscribeErp } from "../db/client";
import { DEFAULT_PROJECT_ID } from "../db/config";
import { initialState, revealAllSteps, revealNextStep, setPackage } from "../engine/commands";
import type { Scene1Variant, V2State } from "../engine/model";

/**
 * External store for the Hadarim app: one persisted domain state (`V2State`) and one persisted UI state.
 * Commands stay pure; the store applies them and, when connected to the database, persists any ERP
 * rows they changed and re-reads the ERP state (so the database, its triggers and its change log are
 * the source of truth). Offline mode (tests, no network) keeps the generator data in the browser only.
 */

export type ErpScreen = "invoices" | "purchase_orders" | "contracts" | "budget" | "change_log";
export type DbStatus = "offline" | "loading" | "online" | "error";

export interface UiState {
  app: "erp" | "control";
  erp: { screen: ErpScreen; invoiceId: number | null; editing: boolean; creating: boolean; poId: number | null; contractId: string | null; sectionId: string | null };
  control: { pane: "chat" | "report"; reportTab: "full" | "ceo"; documentId: string | null; documentAnchor: string | null; recordRef: { type: "invoice" | "po" | "contract"; id: string } | null; pendingExport?: "pdf" | "docx" | null };
  presenter: { skipMotion: boolean; showPresenterBar: boolean; scene1Variant: "A" | "B" };
  db: { status: DbStatus; error: string | null; lastSync: string | null; syncing: boolean };
}

const STATE_KEY = "hadarim-v2";
const UI_KEY = "hadarim-v2-ui";
const OFFLINE_KEY = "hadarim-offline";

export const defaultUi: UiState = {
  app: "erp",
  erp: { screen: "invoices", invoiceId: null, editing: false, creating: false, poId: null, contractId: null, sectionId: null },
  control: { pane: "chat", reportTab: "full", documentId: null, documentAnchor: null, recordRef: null, pendingExport: null },
  presenter: { skipMotion: false, showPresenterBar: true, scene1Variant: "A" },
  db: { status: "offline", error: null, lastSync: null, syncing: false },
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
    /* storage unavailable (private mode, quota) — the app keeps running in memory */
  }
}

/** Offline = browser-only data from the generator. Chosen by `?offline=1`, or the flag in localStorage. */
export function isOfflineRequested(): boolean {
  try {
    if (typeof location !== "undefined" && new URLSearchParams(location.search).get("offline") === "1") {
      localStorage.setItem(OFFLINE_KEY, "1");
      return true;
    }
    return localStorage.getItem(OFFLINE_KEY) === "1";
  } catch {
    return false;
  }
}

class HadarimStore {
  private state: V2State;
  private ui: UiState;
  private listeners = new Set<() => void>();
  private stepTimer: number | null = null;
  private unsubscribeRealtime: (() => void) | null = null;
  private writesInFlight = 0;
  readonly projectId = DEFAULT_PROJECT_ID;

  constructor() {
    this.state = load(STATE_KEY, initialState, (v) => !!v && typeof v === "object" && (v as V2State).version === 1 && Array.isArray((v as V2State).erp?.invoices));
    const ui = load(UI_KEY, () => defaultUi, (v) => !!v && typeof v === "object" && "app" in (v as object));
    this.ui = { ...defaultUi, ...ui, db: { ...defaultUi.db } };
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

  private setDb(patch: Partial<UiState["db"]>): void {
    this.ui = { ...this.ui, db: { ...this.ui.db, ...patch } };
    this.emit();
  }

  /** Connect to the database (unless offline was requested): load the package, replace the ERP state, follow changes. */
  bootstrap = async (): Promise<void> => {
    if (isOfflineRequested()) {
      this.setDb({ status: "offline" });
      return;
    }
    this.setDb({ status: "loading", error: null });
    try {
      const pkg = await loadPackage(this.projectId);
      setPackage(pkg);
      this.state = { ...this.state, erp: { invoices: pkg.invoices, purchaseOrders: pkg.purchaseOrders, changeLog: pkg.changeLog } };
      save(STATE_KEY, this.state);
      this.setDb({ status: "online", lastSync: new Date().toISOString() });
      this.unsubscribeRealtime?.();
      this.unsubscribeRealtime = subscribeErp(this.projectId, () => {
        if (this.writesInFlight === 0) void this.refreshErp();
      });
    } catch (e) {
      this.setDb({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };

  /** Re-read the ERP tables; the database (and its triggers) is the truth once online. */
  refreshErp = async (): Promise<void> => {
    if (this.ui.db.status !== "online") return;
    try {
      const erp = await loadErp(this.projectId);
      this.state = { ...this.state, erp };
      save(STATE_KEY, this.state);
      this.setDb({ lastSync: new Date().toISOString(), error: null });
    } catch (e) {
      this.setDb({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  /** Apply a pure command. Errors propagate to the caller (the UI shows them inline). */
  dispatch = (command: (s: V2State) => V2State): void => {
    const prev = this.state;
    const next = command(prev);
    if (next === prev) return;
    this.state = next;
    save(STATE_KEY, next);
    this.emit();
    if (this.ui.db.status === "online" && next.erp !== prev.erp) void this.persistErpDiff(prev, next);
  };

  /** Persist the ERP rows a command changed, attributed from the change-log entry the command wrote. */
  private async persistErpDiff(prev: V2State, next: V2State): Promise<void> {
    const changedInvoices: { invoice: HInvoice; isNew: boolean }[] = [];
    const prevInvoices = new Map(prev.erp.invoices.map((i) => [i.id, i]));
    for (const invoice of next.erp.invoices) {
      const before = prevInvoices.get(invoice.id);
      if (!before) changedInvoices.push({ invoice, isNew: true });
      else if (before !== invoice) changedInvoices.push({ invoice, isNew: false });
    }
    const prevPos = new Map(prev.erp.purchaseOrders.map((p) => [p.id, p]));
    const changedPos: HPurchaseOrder[] = next.erp.purchaseOrders.filter((p) => prevPos.get(p.id) !== p);
    if (!changedInvoices.length && !changedPos.length) return;
    const newEntries = next.erp.changeLog.slice(prev.erp.changeLog.length);
    const metaFor = (recordType: "invoice" | "po", id: number) => {
      const entry = [...newEntries].reverse().find((c) => c.recordType === recordType && c.recordId === String(id));
      return { byId: entry?.byId ?? next.operatorId, noteHe: entry?.noteHe };
    };
    this.writesInFlight += 1;
    this.setDb({ syncing: true });
    try {
      for (const { invoice, isNew } of changedInvoices) await saveInvoice(invoice, metaFor("invoice", invoice.id), isNew, this.projectId);
      for (const po of changedPos) await savePurchaseOrder(po, metaFor("po", po.id), this.projectId);
      const erp = await loadErp(this.projectId);
      this.state = { ...this.state, erp };
      save(STATE_KEY, this.state);
      this.setDb({ syncing: false, lastSync: new Date().toISOString(), error: null });
    } catch (e) {
      this.setDb({ syncing: false, error: `השמירה למסד הנתונים נכשלה: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      this.writesInFlight -= 1;
    }
  }

  setUi = (patch: Partial<UiState> | ((u: UiState) => UiState)): void => {
    this.ui = typeof patch === "function" ? patch(this.ui) : { ...this.ui, ...patch };
    save(UI_KEY, { ...this.ui, db: undefined });
    this.emit();
  };

  go = (app: UiState["app"]): void => this.setUi((u) => ({ ...u, app }));

  openDocument = (documentId: string, anchor?: string): void => this.setUi((u) => ({ ...u, control: { ...u.control, documentId, documentAnchor: anchor ?? null } }));

  closeDocument = (): void => this.setUi((u) => ({ ...u, control: { ...u.control, documentId: null, documentAnchor: null } }));

  openRecord = (recordRef: UiState["control"]["recordRef"]): void => this.setUi((u) => ({ ...u, control: { ...u.control, recordRef } }));

  /** Ask the report pane to run an export once it is mounted (chat buttons in scene 7). */
  requestExport = (format: "pdf" | "docx"): void => this.setUi((u) => ({ ...u, control: { ...u.control, pane: "report", pendingExport: format } }));

  clearExport = (): void => this.setUi((u) => ({ ...u, control: { ...u.control, pendingExport: null } }));

  setOffline = (offline: boolean): void => {
    try {
      if (offline) localStorage.setItem(OFFLINE_KEY, "1");
      else localStorage.removeItem(OFFLINE_KEY);
    } catch {
      /* ignore */
    }
    if (offline) {
      this.unsubscribeRealtime?.();
      this.unsubscribeRealtime = null;
      this.setDb({ status: "offline", error: null });
    } else {
      void this.bootstrap();
    }
  };

  /** Reveal the control's data-gathering steps one by one (or all at once when motion is skipped). */
  playSteps = (): void => {
    this.stopSteps();
    if (this.ui.presenter.skipMotion) {
      this.dispatch(revealAllSteps);
      return;
    }
    // script pacing: 2–3 s between steps, and the checks line spins for a few seconds before the summary
    const step = () => {
      const before = this.state;
      this.dispatch(revealNextStep);
      const steps = this.state.control.messages.find((m) => m.kind === "steps")?.steps ?? [];
      const done = this.state === before || steps.every((st) => st.done);
      if (done) this.stopSteps();
      else {
        const next = steps.find((st) => !st.done);
        this.stepTimer = window.setTimeout(step, next?.spinner ? 4500 : 2200);
      }
    };
    this.stepTimer = window.setTimeout(step, 900);
  };

  stopSteps = (): void => {
    if (this.stepTimer != null) window.clearTimeout(this.stepTimer);
    this.stepTimer = null;
  };

  /**
   * Reset to seed. Online: the database is restored from its seed snapshot (and, for variant B, the
   * script's invoice is removed so it can be keyed in live), then the app reloads from it. Offline: the
   * generator state is rebuilt in the browser.
   */
  reset = async (variant: Scene1Variant = this.ui.presenter.scene1Variant): Promise<void> => {
    this.stopSteps();
    this.ui = { ...defaultUi, presenter: { ...this.ui.presenter, scene1Variant: variant }, db: this.ui.db };
    save(UI_KEY, { ...this.ui, db: undefined });
    if (this.ui.db.status === "online" || this.ui.db.status === "error") {
      this.setDb({ syncing: true, error: null });
      try {
        await resetProject(this.projectId);
        if (variant === "B") await deleteInvoice(1147, this.projectId);
        const pkg = await loadPackage(this.projectId);
        setPackage(pkg);
        this.state = { ...initialState(variant), erp: { invoices: pkg.invoices, purchaseOrders: pkg.purchaseOrders, changeLog: pkg.changeLog } };
        this.setDb({ status: "online", syncing: false, lastSync: new Date().toISOString() });
      } catch (e) {
        this.setDb({ syncing: false, error: `האיפוס נכשל: ${e instanceof Error ? e.message : String(e)}` });
        this.state = initialState(variant);
      }
    } else {
      this.state = initialState(variant);
    }
    save(STATE_KEY, this.state);
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
if (typeof window !== "undefined") {
  window.__hadarimStore = store;
  void store.bootstrap();
}
