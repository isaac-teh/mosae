import { describe, it, expect } from "vitest";
import { claimForDispatch, markDelivered, newOutboxTask, releaseAfterError, DISPATCH_LEASE_MS } from "./outbox.js";

const base = newOutboxTask({ projectId: "p1", subjectKind: "asset", subjectId: "a1", generation: "9", stage: "ingest", now: 1000 });

describe("newOutboxTask", () => {
  it("derives a deterministic id from the work key", () => {
    expect(base.workKey).toBe("p1:asset:a1:9:ingest:1");
    expect(base.id).toBe("p1_asset_a1_9_ingest_1");
    expect(base).toMatchObject({ state: "pending", attempts: 0, leaseUntil: null, subjectKind: "asset", subjectId: "a1" });
  });

  it("gives a job stage its own document id for the same subject id", () => {
    const planning = newOutboxTask({ projectId: "p1", subjectKind: "job", subjectId: "a1", generation: "9", stage: "plan", now: 1000 });
    expect(planning.id).not.toBe(base.id);
  });
});

describe("dispatch transitions", () => {
  it("claims a pending task with a lease and counts the attempt", () => {
    const claimed = claimForDispatch(base, 2000, DISPATCH_LEASE_MS);
    expect(claimed).toMatchObject({ state: "dispatching", attempts: 1, leaseUntil: 2000 + DISPATCH_LEASE_MS });
  });

  it("does not claim a task whose lease is still active", () => {
    const claimed = claimForDispatch(base, 2000, DISPATCH_LEASE_MS)!;
    expect(claimForDispatch(claimed, 3000, DISPATCH_LEASE_MS)).toBeNull();
  });

  it("reclaims a task whose dispatch lease expired (crash between claim and enqueue)", () => {
    const claimed = claimForDispatch(base, 2000, DISPATCH_LEASE_MS)!;
    const again = claimForDispatch(claimed, 2000 + DISPATCH_LEASE_MS + 1, DISPATCH_LEASE_MS);
    expect(again).toMatchObject({ state: "dispatching", attempts: 2 });
  });

  it("never claims a delivered task", () => {
    const delivered = markDelivered(claimForDispatch(base, 2000, DISPATCH_LEASE_MS)!, 2500);
    expect(delivered).toMatchObject({ state: "delivered", leaseUntil: null });
    expect(claimForDispatch(delivered, 999_999, DISPATCH_LEASE_MS)).toBeNull();
  });

  it("returns an errored task to pending with diagnostics", () => {
    const released = releaseAfterError(claimForDispatch(base, 2000, DISPATCH_LEASE_MS)!, 2100, "queue unavailable");
    expect(released).toMatchObject({ state: "pending", leaseUntil: null, lastError: "queue unavailable", attempts: 1 });
  });
});
