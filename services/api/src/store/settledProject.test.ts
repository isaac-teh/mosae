import { describe, expect, it, vi } from "vitest";
import { settleReadyProject } from "./settledProject.js";

describe("settleReadyProject", () => {
  it("builds the cast as soon as a closed, understood project settles", async () => {
    const result = { settled: true as const, enqueued: true, outcome: "ready" as const, facts: { sessions: 1, openSessions: 0, pendingEntries: 0, assets: 3, ingested: 3, failed: 0 } };
    const settle = vi.fn().mockResolvedValue(result);
    const ensureCast = vi.fn().mockResolvedValue(undefined);
    const dispatchDue = vi.fn().mockResolvedValue(undefined);

    await expect(settleReadyProject({ projectId: "p1", settle, ensureCast, dispatchDue })).resolves.toBe(result);

    expect(ensureCast).toHaveBeenCalledWith("p1");
    expect(dispatchDue).toHaveBeenCalledOnce();
  });

  it("does not build a partial cast while any asset is still processing", async () => {
    const result = { settled: false as const, enqueued: false, outcome: null, facts: { sessions: 1, openSessions: 0, pendingEntries: 0, assets: 3, ingested: 2, failed: 0 } };
    const ensureCast = vi.fn();

    await settleReadyProject({ projectId: "p1", settle: vi.fn().mockResolvedValue(result), ensureCast, dispatchDue: vi.fn() });

    expect(ensureCast).not.toHaveBeenCalled();
  });

  it("still dispatches settled cluster work when cast creation needs a retry", async () => {
    const result = { settled: true as const, enqueued: true, outcome: "ready" as const, facts: { sessions: 1, openSessions: 0, pendingEntries: 0, assets: 3, ingested: 3, failed: 0 } };
    const dispatchDue = vi.fn().mockResolvedValue(undefined);

    await expect(settleReadyProject({
      projectId: "p1", settle: vi.fn().mockResolvedValue(result),
      ensureCast: vi.fn().mockRejectedValue(new Error("storage unavailable")), dispatchDue,
    })).rejects.toThrow("storage unavailable");

    expect(dispatchDue).toHaveBeenCalledOnce();
  });
});
