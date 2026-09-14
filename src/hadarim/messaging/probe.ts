import { db, latestChangeLogId, listHeartbeats } from "../db/client";
import type { MonitorDef, ProbeResult } from "./scheduler";

/**
 * The deterministic probes (docs/heartbeat-bot-plan.md §5.1): is the change log above the last
 * heartbeat's watermark, and is a document unprocessed? Three reads, no model. The reads are injected so
 * the tests run offline; `dbProbeReads` wires the database.
 */

export interface ProbeReads {
  latestChangeLogId(projectId: string): Promise<number>;
  /** The last heartbeat's `until_change_log_id`, or null when the project never had one. */
  lastHeartbeatWatermark(projectId: string): Promise<number | null>;
  /** Documents with no recorded facts that were not replaced by a newer upload. */
  countPendingDocuments(projectId: string): Promise<number>;
}

export function erpMonitor(reads: ProbeReads): MonitorDef {
  return {
    id: "erp",
    async probe(projectId): Promise<ProbeResult> {
      const [latest, watermark] = await Promise.all([reads.latestChangeLogId(projectId), reads.lastHeartbeatWatermark(projectId)]);
      const since = latest - (watermark ?? 0);
      const work = since > 0;
      return { monitor: "erp", work, detailHe: watermark == null ? (work ? `${latest} רשומות ביומן השינויים, טרם נרשמה פעימת לב` : "יומן השינויים ריק") : work ? `${since} שינויים מאז פעימת הלב האחרונה (${watermark}→${latest})` : `אין שינויים מאז פעימת הלב האחרונה (${watermark})` };
    },
  };
}

export function documentsMonitor(reads: ProbeReads): MonitorDef {
  return {
    id: "documents",
    async probe(projectId): Promise<ProbeResult> {
      const pending = await reads.countPendingDocuments(projectId);
      return { monitor: "documents", work: pending > 0, detailHe: pending ? `${pending} מסמכים ממתינים לעיבוד` : "אין מסמכים ממתינים" };
    },
  };
}

export function dbProbeReads(): ProbeReads {
  return {
    latestChangeLogId: (projectId) => latestChangeLogId(projectId),
    lastHeartbeatWatermark: async (projectId) => {
      const rows = await listHeartbeats(projectId, 1);
      return rows[0]?.untilChangeLogId ?? null;
    },
    countPendingDocuments: async (projectId) => {
      const { count, error } = await db().from("documents").select("id", { count: "exact", head: true }).eq("project_id", projectId).is("facts_source", null).is("superseded_by", null);
      if (error) throw new Error(`documents: ${error.message}`);
      return count ?? 0;
    },
  };
}

export function allMonitors(reads: ProbeReads = dbProbeReads()): MonitorDef[] {
  return [documentsMonitor(reads), erpMonitor(reads)];
}
