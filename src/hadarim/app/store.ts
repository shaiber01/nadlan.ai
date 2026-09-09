import { useSyncExternalStore } from "react";
import type { HInvoice, HPurchaseOrder } from "../data/types";
import { addDocument, deleteInvoice, documentFilePath, getReportVersion, listReportVersions, loadErp, nextDocumentId, resetProject, saveInvoice, savePurchaseOrder, subscribeProject, uploadDocumentFile, type ReportVersionSummary } from "../db/client";
import { mimeTypeFor } from "../documents/mime";
import type { HDocument } from "../data/types";
import { DEFAULT_PROJECT_ID } from "../db/config";
import { loadState } from "../db/session";
import { SCRIPT_INVOICE_ID, initialState } from "../engine/commands";
import type { Scene1Variant, V2State } from "../engine/model";

/**
 * External store for the Hadarim web app: the simulated ERP and a live view of the control.
 *
 * Online, the database is the source of truth: the whole session (`V2State` — ERP rows plus the control
 * the agent writes through its tools) is loaded from it and re-loaded on Realtime changes. The browser
 * writes only ERP rows (the ERP screens' edits), through the attributed writers, so the triggers log
 * them. The control itself is never changed from the browser. Offline mode (tests, no network) keeps
 * the generator data in the browser only.
 */

export type ErpScreen = "invoices" | "purchase_orders" | "contracts" | "budget" | "change_log" | "documents";
export type DbStatus = "offline" | "loading" | "online" | "error";

export interface UiState {
  erp: { screen: ErpScreen; invoiceId: number | null; editing: boolean; creating: boolean; poId: number | null; contractId: string | null; sectionId: string | null };
  /** Document and record viewers, shared by the ERP and the report. */
  viewer: { documentId: string | null; documentAnchor: string | null; recordRef: { type: "invoice" | "po" | "contract"; id: string } | null };
  report: { tab: "full" | "ceo"; versionId: number | null };
  presenter: { showPresenterBar: boolean; scene1Variant: "A" | "B" };
  db: { status: DbStatus; error: string | null; lastSync: string | null; syncing: boolean };
}

const STATE_KEY = "hadarim-v2";
const UI_KEY = "hadarim-v2-ui";
const OFFLINE_KEY = "hadarim-offline";

export const defaultUi: UiState = {
  erp: { screen: "invoices", invoiceId: null, editing: false, creating: false, poId: null, contractId: null, sectionId: null },
  viewer: { documentId: null, documentAnchor: null, recordRef: null },
  report: { tab: "full", versionId: null },
  presenter: { showPresenterBar: true, scene1Variant: "A" },
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

/**
 * The ERP is opened by its own page (`hadarim.html`); a record can be addressed by URL — `?screen=invoices&invoice=1147`,
 * `?screen=purchase_orders&po=2291`, `?screen=contracts&contract=03-F`, `?screen=budget` — which is how the report's
 * source links open an ERP record in a new tab. The report has its own page (`report.html`).
 */
export function erpRecordUrl(patch: Partial<UiState["erp"]>): string {
  const params = new URLSearchParams();
  if (patch.screen) params.set("screen", patch.screen);
  if (patch.invoiceId != null) params.set("invoice", String(patch.invoiceId));
  if (patch.poId != null) params.set("po", String(patch.poId));
  if (patch.contractId) params.set("contract", patch.contractId);
  if (patch.sectionId) params.set("section", patch.sectionId);
  const q = params.toString();
  return `hadarim.html${q ? `?${q}` : ""}`;
}

/** The ERP screen and record requested in the page's URL, if any. */
function requestedErp(): Partial<UiState["erp"]> | null {
  try {
    if (typeof location === "undefined") return null;
    const q = new URLSearchParams(location.search);
    const screen = q.get("screen") as ErpScreen | null;
    const out: Partial<UiState["erp"]> = {};
    if (screen && ["invoices", "purchase_orders", "contracts", "budget", "change_log", "documents"].includes(screen)) out.screen = screen;
    if (q.get("invoice")) out.invoiceId = Number(q.get("invoice"));
    if (q.get("po")) out.poId = Number(q.get("po"));
    if (q.get("contract")) out.contractId = q.get("contract");
    if (q.get("section")) out.sectionId = q.get("section");
    return Object.keys(out).length ? { ...out, editing: false, creating: false } : null;
  } catch {
    return null;
  }
}

const isState = (v: unknown): v is V2State => !!v && typeof v === "object" && (v as V2State).version === 1 && Array.isArray((v as V2State).erp?.invoices) && Array.isArray((v as V2State).control?.notes) && Array.isArray((v as V2State).control?.tasks);

class HadarimStore {
  private state: V2State;
  private ui: UiState;
  private versions: ReportVersionSummary[] = [];
  private listeners = new Set<() => void>();
  private unsubscribeRealtime: (() => void) | null = null;
  private writesInFlight = 0;
  readonly projectId = DEFAULT_PROJECT_ID;

  constructor() {
    this.state = load(STATE_KEY, initialState, isState);
    const ui = load(UI_KEY, () => defaultUi, (v) => !!v && typeof v === "object" && "app" in (v as object)) as Partial<UiState>;
    this.ui = { ...defaultUi, ...ui, erp: { ...defaultUi.erp, ...(ui.erp ?? {}), ...(requestedErp() ?? {}) }, viewer: { ...defaultUi.viewer, ...(ui.viewer ?? {}) }, report: { ...defaultUi.report, ...(ui.report ?? {}) }, presenter: { ...defaultUi.presenter, ...(ui.presenter ?? {}) }, db: { ...defaultUi.db } };
  }

  getState = (): V2State => this.state;
  getUi = (): UiState => this.ui;
  getVersions = (): ReportVersionSummary[] => this.versions;

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

  /** Connect to the database (unless offline was requested): load the session, then follow changes. */
  bootstrap = async (): Promise<void> => {
    if (isOfflineRequested()) {
      this.setDb({ status: "offline" });
      return;
    }
    this.setDb({ status: "loading", error: null });
    try {
      await this.loadFromDb();
      this.setDb({ status: "online" });
      this.unsubscribeRealtime?.();
      this.unsubscribeRealtime = subscribeProject(this.projectId, () => {
        if (this.writesInFlight === 0) void this.refresh();
      });
    } catch (e) {
      this.setDb({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };

  private async loadFromDb(): Promise<void> {
    const [session, versions] = await Promise.all([loadState(this.projectId), listReportVersions(this.projectId)]);
    this.state = { ...session, variant: this.state.variant };
    this.versions = versions;
    save(STATE_KEY, this.state);
    this.setDb({ lastSync: new Date().toISOString(), error: null });
  }

  /** Re-read the session (ERP and control) and the saved reports; the database is the truth once online. */
  refresh = async (): Promise<void> => {
    if (this.ui.db.status !== "online") return;
    try {
      await this.loadFromDb();
    } catch (e) {
      this.setDb({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  /**
   * Upload a real document to the project folder (Storage + a folder row). The row stays unprocessed until the
   * agent reads it; the browser never extracts or interprets anything. Needs the database.
   */
  uploadDocument = async (file: File, meta: { kind: HDocument["kind"]; titleHe: string; date: string; supplierId: string | null; recordRef: { type: "invoice" | "po" | "contract"; id: string } | null; byId: string }): Promise<HDocument> => {
    if (this.ui.db.status !== "online") throw new Error("העלאת מסמכים דורשת חיבור למסד הנתונים (כבה ״עבודה מקומית״).");
    this.writesInFlight += 1;
    this.setDb({ syncing: true });
    try {
      const id = await nextDocumentId(this.projectId);
      const mimeType = mimeTypeFor(file.name, file.type);
      const filePath = await uploadDocumentFile(documentFilePath(this.projectId, id, file.name), file, mimeType);
      const doc = await addDocument(this.projectId, { id, kind: meta.kind, titleHe: meta.titleHe || file.name, date: meta.date, supplierId: meta.supplierId, fileName: file.name, filePath, mimeType, sizeBytes: file.size, uploadedById: meta.byId, recordRef: meta.recordRef });
      this.setDb({ syncing: false, lastSync: new Date().toISOString(), error: null });
      await this.loadFromDb();
      return doc;
    } catch (e) {
      this.setDb({ syncing: false });
      throw e;
    } finally {
      this.writesInFlight -= 1;
    }
  };

  /** A saved report version with its model, or null for the live report. */
  loadVersion = (id: number): Promise<Awaited<ReturnType<typeof getReportVersion>>> => getReportVersion(id, this.projectId);

  /** Apply a pure ERP command. Errors propagate to the caller (the UI shows them inline). */
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


  openDocument = (documentId: string, anchor?: string): void => this.setUi((u) => ({ ...u, viewer: { ...u.viewer, documentId, documentAnchor: anchor ?? null } }));

  closeDocument = (): void => this.setUi((u) => ({ ...u, viewer: { ...u.viewer, documentId: null, documentAnchor: null } }));

  openRecord = (recordRef: UiState["viewer"]["recordRef"]): void => this.setUi((u) => ({ ...u, viewer: { ...u.viewer, recordRef } }));

  setReportTab = (tab: UiState["report"]["tab"]): void => this.setUi((u) => ({ ...u, report: { ...u.report, tab } }));

  selectVersion = (versionId: number | null): void => this.setUi((u) => ({ ...u, report: { ...u.report, versionId } }));

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
      this.versions = [];
      this.setDb({ status: "offline", error: null });
    } else {
      void this.bootstrap();
    }
  };

  /**
   * Reset to seed. Online: the database is restored from its seed snapshot (and, for variant B, the
   * seed's script invoice is removed so it can be keyed in live), then the session reloads from it.
   * Offline: the generator state is rebuilt in the browser.
   */
  reset = async (variant: Scene1Variant = this.ui.presenter.scene1Variant): Promise<void> => {
    this.ui = { ...defaultUi, presenter: { ...this.ui.presenter, scene1Variant: variant }, db: this.ui.db };
    save(UI_KEY, { ...this.ui, db: undefined });
    if (this.ui.db.status === "online" || this.ui.db.status === "error") {
      this.setDb({ syncing: true, error: null });
      try {
        await resetProject(this.projectId);
        if (variant === "B") await deleteInvoice(SCRIPT_INVOICE_ID, this.projectId);
        this.state = { ...this.state, variant };
        await this.loadFromDb();
        this.setDb({ status: "online", syncing: false });
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

export function useReportVersions(): ReportVersionSummary[] {
  return useSyncExternalStore(store.subscribe, store.getVersions, store.getVersions);
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
