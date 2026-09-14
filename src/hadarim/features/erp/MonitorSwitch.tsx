import { useEffect, useState } from "react";
import { MIN_INTERVAL_SECONDS, type MonitorSettings } from "../../messaging/scheduler";
import { daemonAlive, readMonitorSettings, subscribeMonitorSettings, writeMonitorSettings } from "../../messaging/settings";
import "./monitor.css";

/**
 * The presenter strip's heartbeat switch (docs/heartbeat-bot-plan.md §4.2): on/off, "check every N
 * seconds", and whether the monitor process is alive (it stamps every tick). Self-contained: reads and
 * writes `monitor_settings` through the messaging layer, follows it through Realtime, and touches nothing
 * of the store. Rendered only with the database online.
 */
export function MonitorSwitch({ projectId, online, operatorId }: { projectId: string; online: boolean; operatorId: string }) {
  const [settings, setSettings] = useState<MonitorSettings | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!online) return;
    let alive = true;
    readMonitorSettings(projectId).then((s) => alive && setSettings(s), (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    const unsubscribe = subscribeMonitorSettings(projectId, (s) => alive && setSettings(s));
    const clock = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      alive = false;
      unsubscribe();
      clearInterval(clock);
    };
  }, [projectId, online]);

  if (!online) return null;

  const enabled = settings?.enabled ?? false;
  const seconds = settings?.intervalSeconds ?? 300;
  const running = daemonAlive(settings, now);

  const write = async (patch: Parameters<typeof writeMonitorSettings>[1]) => {
    setBusy(true);
    setError(null);
    try {
      setSettings(await writeMonitorSettings(projectId, patch, operatorId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const commitInterval = () => {
    if (draft == null) return;
    const n = Number(draft);
    setDraft(null);
    if (!Number.isFinite(n) || n < MIN_INTERVAL_SECONDS) {
      setError(`המרווח חייב להיות לפחות ${MIN_INTERVAL_SECONDS} שניות`);
      return;
    }
    if (Math.round(n) !== seconds) void write({ intervalSeconds: Math.round(n) });
  };

  const lastTick = settings?.lastTickAt ? Math.max(0, Math.round((now - Date.parse(settings.lastTickAt)) / 1000)) : null;
  const ago = lastTick == null ? "" : lastTick < 90 ? `לפני ${lastTick} שניות` : `לפני ${Math.round(lastTick / 60)} דקות`;
  const stateHe = !settings ? "המנטר · לא הוגדר" : running ? `המנטר · פועל · בדיקה ${ago}` : enabled ? "המנטר · לא פועל" : "המנטר · כבוי";
  const stateClass = running ? "is-online" : enabled ? "is-error" : "";

  return (
    <span className="h2-presenter-monitor" data-testid="monitor-switch">
      <label className="h2-presenter-toggle">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={() => void write({ enabled: !enabled })} data-testid="monitor-enabled" />
        פעימת לב
      </label>
      <label className="h2-presenter-toggle">
        כל
        <input
          type="number"
          min={MIN_INTERVAL_SECONDS}
          className="h2-presenter-monitor-interval"
          value={draft ?? String(seconds)}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitInterval}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          data-testid="monitor-interval"
        />
        שניות
      </label>
      <span className={`h2-presenter-db ${stateClass}`} title={settings?.lastTickAt ? `בדיקה אחרונה ${new Date(settings.lastTickAt).toLocaleTimeString("he-IL")}${settings.lastTickFoundWork ? " · נמצאה עבודה" : ""}` : "המנטר טרם דיווח על בדיקה"} data-testid="monitor-state">
        {stateHe}
      </span>
      {error ? <span className="h2-presenter-monitor-error">{error}</span> : null}
    </span>
  );
}
