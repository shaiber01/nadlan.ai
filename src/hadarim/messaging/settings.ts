import { db, type Db } from "../db/client";
import type { Json, Tables } from "../db/types";
import { MIN_INTERVAL_SECONDS, STANDARD_MONITOR_SETTINGS, type MonitorSettings } from "./scheduler";

/**
 * The heartbeat settings of a project (docs/heartbeat-bot-plan.md §4): one row in `monitor_settings`,
 * outside the seed and outside reset. Browser-safe — the presenter strip's switch reads and writes it
 * here; the daemon reads it on every tick and is woken by Realtime when it changes. A project with no
 * row is disabled.
 */

export function rowToSettings(r: Tables<"monitor_settings">): MonitorSettings {
  return {
    projectId: r.project_id,
    enabled: r.enabled,
    intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, r.interval_seconds),
    notifyOnQuiet: r.notify_on_quiet,
    monitors: ((r.monitors ?? {}) as MonitorSettings["monitors"]) || {},
    lastTickAt: r.last_tick_at,
    lastTickFoundWork: r.last_tick_found_work,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

export async function readMonitorSettings(projectId: string, supabase: Db = db()): Promise<MonitorSettings | null> {
  const { data, error } = await supabase.from("monitor_settings").select("*").eq("project_id", projectId).maybeSingle();
  if (error) throw new Error(`monitor_settings: ${error.message}`);
  return data ? rowToSettings(data) : null;
}

export type MonitorSettingsPatch = Partial<Pick<MonitorSettings, "enabled" | "intervalSeconds" | "notifyOnQuiet" | "monitors">>;

/** Create or update the row; a missing row starts from the standard defaults. */
export async function writeMonitorSettings(projectId: string, patch: MonitorSettingsPatch, updatedBy: string | null, supabase: Db = db()): Promise<MonitorSettings> {
  const current = await readMonitorSettings(projectId, supabase);
  const next = { ...STANDARD_MONITOR_SETTINGS, ...(current ? { enabled: current.enabled, intervalSeconds: current.intervalSeconds, notifyOnQuiet: current.notifyOnQuiet, monitors: current.monitors } : {}), ...patch };
  if (!Number.isFinite(next.intervalSeconds) || next.intervalSeconds < MIN_INTERVAL_SECONDS) throw new Error(`המרווח חייב להיות לפחות ${MIN_INTERVAL_SECONDS} שניות`);
  const row = { project_id: projectId, enabled: next.enabled, interval_seconds: Math.round(next.intervalSeconds), notify_on_quiet: next.notifyOnQuiet, monitors: next.monitors as Json, updated_by: updatedBy, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("monitor_settings").upsert(row, { onConflict: "project_id" }).select("*").single();
  if (error) throw new Error(`monitor_settings: ${error.message}`);
  return rowToSettings(data);
}

/** "The monitor is alive": the daemon stamps every tick. */
export async function recordMonitorTick(projectId: string, at: Date, foundWork: boolean, supabase: Db = db()): Promise<void> {
  const { error } = await supabase.from("monitor_settings").update({ last_tick_at: at.toISOString(), last_tick_found_work: foundWork }).eq("project_id", projectId);
  if (error) throw new Error(`monitor_settings: ${error.message}`);
}

/** Calls `onChange` with the fresh row whenever it changes. Returns the unsubscribe. */
export function subscribeMonitorSettings(projectId: string, onChange: (s: MonitorSettings | null) => void, supabase: Db = db()): () => void {
  const channel = supabase.channel(`monitor-settings-${projectId}`);
  channel.on("postgres_changes", { event: "*", schema: "public", table: "monitor_settings", filter: `project_id=eq.${projectId}` }, () => {
    void readMonitorSettings(projectId, supabase).then(onChange, () => onChange(null));
  });
  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * What a settings change is, for the daemon: the switch, the intervals and the quiet flag — not the tick
 * stamp the daemon writes itself, which also arrives through Realtime and must not wake it.
 */
export function settingsChangeKey(s: MonitorSettings | null): string {
  return s ? JSON.stringify([s.enabled, s.intervalSeconds, s.notifyOnQuiet, s.monitors ?? {}]) : "none";
}

/** The daemon ticked recently enough (three intervals, plus slack) to count as running. */
export function daemonAlive(s: MonitorSettings | null, now: number = Date.now()): boolean {
  if (!s?.lastTickAt) return false;
  const age = now - Date.parse(s.lastTickAt);
  return age <= s.intervalSeconds * 3 * 1000 + 10_000;
}
