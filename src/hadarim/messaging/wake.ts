import { db, type Db } from "../db/client";

/**
 * Instant reaction (docs/heartbeat-bot-plan.md §10, phase 5): wake the daemon when the ERP changes — a
 * change-log row, which every attributed insert or edit produces — or when a document is uploaded or
 * replaced, debounced so a multi-row edit wakes it once. The interval stays as the ceiling.
 */
export function subscribeErpChanges(projectId: string, onChange: (what: string) => void, debounceMs = 1500, supabase: Db = db()): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Set<string>();
  const bump = (what: string) => {
    pending.add(what);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const what = [...pending].join(", ");
      pending.clear();
      timer = null;
      onChange(what);
    }, debounceMs);
  };
  const channel = supabase.channel(`monitor-wake-${projectId}`);
  channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "change_log", filter: `project_id=eq.${projectId}` }, () => bump("change_log"));
  channel.on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `project_id=eq.${projectId}` }, () => bump("documents"));
  channel.subscribe();
  return () => {
    if (timer) clearTimeout(timer);
    void supabase.removeChannel(channel);
  };
}
