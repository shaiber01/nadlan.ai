/**
 * The heartbeat's scheduler (docs/heartbeat-bot-plan.md §4.3, §5.1): a `setTimeout` chain over the
 * project's settings, re-read on every tick. Disabled means no timer at all. Each tick runs the cheap
 * probes of the monitors that are due (no model), and only when one of them found work does it run the
 * agent's pass — never two at once. After two failed passes the project waits ten intervals. Pure over
 * injected reads and clock, so the tests drive it with fake timers.
 */

export type MonitorId = "documents" | "erp";
export const MONITOR_IDS: readonly MonitorId[] = ["documents", "erp"];
export const MIN_INTERVAL_SECONDS = 15;

export interface MonitorSettings {
  projectId: string;
  enabled: boolean;
  intervalSeconds: number;
  /** A one-line summary is sent even when the pass found nothing to decide. */
  notifyOnQuiet: boolean;
  /** Probe as soon as the ERP changes or a document arrives; the interval is then only the ceiling. */
  wakeOnChange: boolean;
  /** Per-monitor overrides; empty = the default interval for every monitor. */
  monitors: Partial<Record<MonitorId, { intervalSeconds?: number }>>;
  lastTickAt: string | null;
  lastTickFoundWork: boolean | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const STANDARD_MONITOR_SETTINGS: Pick<MonitorSettings, "enabled" | "intervalSeconds" | "notifyOnQuiet" | "wakeOnChange" | "monitors"> = { enabled: false, intervalSeconds: 300, notifyOnQuiet: true, wakeOnChange: true, monitors: {} };

export function intervalFor(s: Pick<MonitorSettings, "intervalSeconds" | "monitors">, id: MonitorId): number {
  const seconds = s.monitors?.[id]?.intervalSeconds ?? s.intervalSeconds;
  return Math.max(MIN_INTERVAL_SECONDS, Number(seconds) || STANDARD_MONITOR_SETTINGS.intervalSeconds);
}

export interface ProbeResult {
  monitor: MonitorId;
  work: boolean;
  detailHe: string;
  error?: string;
}

export interface MonitorDef {
  id: MonitorId;
  probe(projectId: string): Promise<ProbeResult>;
}

export type LastRun = Partial<Record<MonitorId, number>>;

/** The monitors whose interval has elapsed since their last probe (a monitor never probed is due). */
export function dueMonitors(s: MonitorSettings, ids: readonly MonitorId[], now: number, lastRun: LastRun): MonitorId[] {
  return ids.filter((id) => {
    const last = lastRun[id];
    return last == null || now - last >= intervalFor(s, id) * 1000;
  });
}

/** Milliseconds until the next monitor is due (0 when one is due now). */
export function nextDelayMs(s: MonitorSettings, ids: readonly MonitorId[], now: number, lastRun: LastRun): number {
  let delay = Number.POSITIVE_INFINITY;
  for (const id of ids) {
    const last = lastRun[id];
    const d = last == null ? 0 : Math.max(0, last + intervalFor(s, id) * 1000 - now);
    delay = Math.min(delay, d);
  }
  return Number.isFinite(delay) ? delay : intervalFor(s, "erp") * 1000;
}

export interface PassOutcome {
  ok: boolean;
  /** The pass was not started (a question is still waiting for an answer); not a failure. */
  deferred?: boolean;
  error?: string;
}

export interface SchedulerOptions {
  projectId: string;
  readSettings(): Promise<MonitorSettings | null>;
  monitors: MonitorDef[];
  runPass(results: ProbeResult[]): Promise<PassOutcome>;
  /** "The monitor is alive": written on every tick for the presenter strip and the status command. */
  recordTick?(at: Date, foundWork: boolean): Promise<void>;
  log?(line: string): void;
  now?: () => number;
  backoffAfterFailures?: number;
  backoffFactor?: number;
}

export interface TickOutcome {
  skipped?: "disabled" | "ticking" | "not_due" | "error";
  work?: boolean;
  pass?: PassOutcome;
}

/** After an unreachable database: retry sooner than the interval, backing off up to a ceiling. */
export const RETRY_AFTER_ERROR_MS = 15_000;
export const RETRY_AFTER_ERROR_MAX_MS = 5 * 60_000;

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private ticking = false;
  private wakeRequested = false;
  private forceDue = false;
  private lastRun: LastRun = {};
  failures = 0;
  lastTickAt: number | null = null;
  lastFoundWork: boolean | null = null;
  nextAt: number | null = null;

  constructor(private readonly opts: SchedulerOptions) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  get state(): { running: boolean; timerSet: boolean; ticking: boolean; failures: number; lastTickAt: number | null; lastFoundWork: boolean | null; nextAt: number | null } {
    return { running: this.running, timerSet: this.timer != null, ticking: this.ticking, failures: this.failures, lastTickAt: this.lastTickAt, lastFoundWork: this.lastFoundWork, nextAt: this.nextAt };
  }

  /** Start: the first tick runs at once, and the settings decide whether a timer exists after it. */
  start(): void {
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    this.clear();
  }

  /**
   * Re-evaluate now rather than at the next tick: the settings changed (Realtime), or — with `force` —
   * something changed in the ERP, so every monitor is probed at once whether or not its interval elapsed.
   */
  wake(opts: { force?: boolean } = {}): void {
    if (!this.running) return;
    if (opts.force) this.forceDue = true;
    if (this.ticking) {
      this.wakeRequested = true;
      return;
    }
    this.schedule(0);
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextAt = null;
  }

  private schedule(delayMs: number): void {
    this.clear();
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.nextAt = this.now() + delayMs;
  }

  /** One tick: settings → due monitors → probes → the pass when there is work → the next timer. */
  async tick(): Promise<TickOutcome> {
    if (this.ticking) return { skipped: "ticking" };
    this.ticking = true;
    try {
      let s: MonitorSettings | null;
      try {
        s = await this.opts.readSettings();
      } catch (e) {
        // the database was unreachable (the network dropped): keep the chain alive and try again after a while
        this.failures++;
        const retryMs = Math.min(RETRY_AFTER_ERROR_MS * this.failures, RETRY_AFTER_ERROR_MAX_MS);
        this.log(`settings unreadable (${e instanceof Error ? e.message : String(e)}); retrying in ${Math.round(retryMs / 1000)} s`);
        this.schedule(retryMs);
        return { skipped: "error" };
      }
      if (!s?.enabled) {
        this.clear();
        this.log("disabled: no timer");
        return { skipped: "disabled" };
      }
      const ids = this.opts.monitors.map((m) => m.id);
      const now = this.now();
      const due = this.forceDue ? [...ids] : dueMonitors(s, ids, now, this.lastRun);
      this.forceDue = false;
      if (!due.length) {
        this.schedule(nextDelayMs(s, ids, now, this.lastRun));
        return { skipped: "not_due" };
      }
      const results = await Promise.all(
        this.opts.monitors
          .filter((m) => due.includes(m.id))
          .map((m) => m.probe(this.opts.projectId).catch((e: unknown): ProbeResult => ({ monitor: m.id, work: false, detailHe: "הבדיקה נכשלה", error: e instanceof Error ? e.message : String(e) }))),
      );
      for (const id of due) this.lastRun[id] = now;
      const found = results.some((r) => r.work);
      this.lastTickAt = now;
      this.lastFoundWork = found;
      this.log(`tick · ${results.map((r) => `${r.monitor}: ${r.detailHe}${r.error ? ` (${r.error})` : ""}`).join(" · ")}`);
      try {
        await this.opts.recordTick?.(new Date(now), found);
      } catch (e) {
        this.log(`recording the tick failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (results.every((r) => r.error)) {
        // every probe failed (the database unreachable): not a quiet tick — retry soon, count it
        this.failures++;
        this.schedule(Math.min(RETRY_AFTER_ERROR_MS * this.failures, RETRY_AFTER_ERROR_MAX_MS));
        return { skipped: "error" };
      }
      if (!found) {
        this.failures = 0;
        this.schedule(nextDelayMs(s, ids, this.now(), this.lastRun));
        return { work: false };
      }
      let pass: PassOutcome;
      try {
        pass = await this.opts.runPass(results);
      } catch (e) {
        pass = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      if (pass.deferred) this.log("pass deferred: a question is waiting for an answer");
      else if (pass.ok) this.failures = 0;
      else {
        this.failures++;
        this.log(`pass failed (${this.failures}): ${pass.error ?? "?"}`);
      }
      const backoffAfter = this.opts.backoffAfterFailures ?? 2;
      const factor = this.opts.backoffFactor ?? 10;
      const delay = this.failures >= backoffAfter ? intervalFor(s, "erp") * 1000 * factor : nextDelayMs(s, ids, this.now(), this.lastRun);
      this.schedule(delay);
      return { work: true, pass };
    } finally {
      this.ticking = false;
      if (this.wakeRequested) {
        this.wakeRequested = false;
        this.schedule(0);
      }
    }
  }

  private log(line: string): void {
    this.opts.log?.(line);
  }
}
