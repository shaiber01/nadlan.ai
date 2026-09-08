import { beforeEach, describe, expect, it, vi } from "vitest";

/** Minimal localStorage shim for the store's persistence in node. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

describe("DemoStore sessions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
    vi.resetModules();
  });

  it("saves the free-exploration workspace when a scenario starts and restores it on exit", async () => {
    const { DemoStore } = await import("../src/app/store");
    const { askQuestion } = await import("../src/domain/commands/chat");
    const store = new DemoStore();
    store.dispatch((s) => askQuestion(s, "כמה הוצאנו על ברזל בהדרים?"));
    const workspaceSession = store.getSnapshot().state.sessionId;
    expect(store.getSnapshot().state.chat.messages).toHaveLength(2);
    store.loadScenario("S04");
    expect(store.getSnapshot().mode).toBe("scenario");
    expect(store.getSnapshot().state.sessionId).not.toBe(workspaceSession);
    expect(store.getSnapshot().state.chat.messages).toHaveLength(0);
    expect(store.getSnapshot().state.erpRecords.find((r) => r.id === "TX-H-STEEL")?.quantity).toBe(200);
    store.exitToWorkspace();
    expect(store.getSnapshot().mode).toBe("workspace");
    expect(store.getSnapshot().state.sessionId).toBe(workspaceSession);
    expect(store.getSnapshot().state.chat.messages).toHaveLength(2);
  });

  it("runs scheduled analysis after a short delay and ignores results from a discarded session", async () => {
    const { DemoStore } = await import("../src/app/store");
    const { saveErpRecord } = await import("../src/domain/commands/core");
    const store = new DemoStore();
    store.loadScenario("S04");
    store.dispatch((s) => saveErpRecord(s, "TX-H-STEEL", { quantity: 200 }));
    expect(store.getSnapshot().analyzing).toBe(true);
    // reset before the timer fires: the stale result must not touch the new session
    store.resetDemo();
    vi.advanceTimersByTime(2000);
    const after = store.getSnapshot().state;
    expect(after.findings.some((f) => f.kind === "quantity_mismatch")).toBe(false);
    expect(after.findings.map((f) => f.kind).sort()).toEqual(["missing_allocation", "price_risk"]);
    // now a real save in the current session produces the finding once the timer fires
    store.loadScenario("S04");
    store.dispatch((s) => saveErpRecord(s, "TX-H-STEEL", { quantity: 200 }));
    vi.advanceTimersByTime(2000);
    expect(store.getSnapshot().state.findings.filter((f) => f.kind === "quantity_mismatch")).toHaveLength(1);
  });

  it("persists to localStorage keyed by seed version and refuses incompatible data", async () => {
    const { DemoStore } = await import("../src/app/store");
    const store = new DemoStore();
    store.setRole("reviewer");
    vi.advanceTimersByTime(500);
    const raw = localStorage.getItem("bakara-demo-v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.seedVersion).toBe("construction-demo-v1.1");
    localStorage.setItem("bakara-demo-v1", JSON.stringify({ ...parsed, seedVersion: "old" }));
    vi.resetModules();
    const { DemoStore: Fresh } = await import("../src/app/store");
    const fresh = new Fresh();
    expect(fresh.getSnapshot().incompatibleStorage).toBe(true);
    expect(fresh.getSnapshot().state.role).toBe("manager");
  });

  it("tour continues S06 on the S04 state and loads fixtures where required", async () => {
    const { DemoStore } = await import("../src/app/store");
    const { approveProposal } = await import("../src/domain/commands/review");
    const { runPendingAnalyses } = await import("../src/domain/commands/core");
    const store = new DemoStore();
    store.startTour();
    expect(store.getSnapshot().scenario?.id).toBe("S04");
    store.receiveScenarioEvent("S04-SAVE");
    store.dispatch((s) => runPendingAnalyses(s));
    const p = store.getSnapshot().state.proposals.find((x) => x.kind === "erp_correction" && x.status === "pending_review")!;
    store.dispatch((s) => runPendingAnalyses(approveProposal(s, p.id, "REVIEWER")));
    const sessionBefore = store.getSnapshot().state.sessionId;
    store.nextTourSegment();
    expect(store.getSnapshot().scenario?.id).toBe("S06");
    expect(store.getSnapshot().state.sessionId).toBe(sessionBefore);
    expect(store.getSnapshot().state.findings.some((f) => f.kind === "price_risk")).toBe(true);
    store.nextTourSegment(); // S07 continue
    store.nextTourSegment(); // S01 continue
    expect(store.getSnapshot().state.sessionId).toBe(sessionBefore);
    store.nextTourSegment(); // S05 load
    expect(store.getSnapshot().scenario?.id).toBe("S05");
    expect(store.getSnapshot().state.sessionId).not.toBe(sessionBefore);
  });
});
