import { describe, it, expect } from "vitest";
import { readinessOf, READY_STATUS, type ProjectFacts } from "./readiness.js";

const settled: ProjectFacts = { sessions: 1, openSessions: 0, pendingEntries: 0, assets: 3, ingested: 3, failed: 0 };

describe("readinessOf", () => {
  it("is ready when every asset ingested and no upload is outstanding", () => {
    expect(readinessOf(settled)).toEqual({ settled: true, outcome: "ready" });
  });

  it("is ready with errors when some assets failed but some ingested", () => {
    expect(readinessOf({ ...settled, ingested: 2, failed: 1 })).toEqual({ settled: true, outcome: "ready_with_errors" });
  });

  it("is failed when nothing usable remains", () => {
    expect(readinessOf({ ...settled, ingested: 0, failed: 3 })).toEqual({ settled: true, outcome: "failed" });
  });

  it("is failed, not stuck, when every upload was cancelled and no asset exists", () => {
    expect(readinessOf({ sessions: 1, openSessions: 0, pendingEntries: 0, assets: 0, ingested: 0, failed: 0 })).toEqual({ settled: true, outcome: "failed" });
  });

  it("is not settled while any session is still open", () => {
    expect(readinessOf({ ...settled, openSessions: 1 })).toEqual({ settled: false });
  });

  it("is not settled while an upload entry is still pending", () => {
    expect(readinessOf({ ...settled, pendingEntries: 1 })).toEqual({ settled: false });
  });

  it("is not settled while an asset is still being ingested", () => {
    expect(readinessOf({ ...settled, ingested: 2 })).toEqual({ settled: false });
  });

  it("is not settled for a project that has never opened an upload session", () => {
    expect(readinessOf({ sessions: 0, openSessions: 0, pendingEntries: 0, assets: 0, ingested: 0, failed: 0 })).toEqual({ settled: false });
  });

  it("names understood as the ready status for this phase", () => {
    expect(READY_STATUS).toBe("understood");
  });
});
