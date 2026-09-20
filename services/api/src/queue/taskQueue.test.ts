import { describe, it, expect } from "vitest";
import { InMemoryTaskQueue } from "./taskQueue.js";

const task = { name: "p_asset_a_1_ingest_1", path: "/tasks/ingest" as const, body: { projectId: "p", subjectKind: "asset" as const, subjectId: "a", generation: "1", workKey: "p:asset:a:1:ingest:1" } };

describe("InMemoryTaskQueue", () => {
  it("deduplicates by task name", async () => {
    const q = new InMemoryTaskQueue();
    expect(await q.enqueue(task)).toBe("enqueued");
    expect(await q.enqueue(task)).toBe("already_exists");
    expect(q.tasks).toHaveLength(1);
  });

  it("can fail one named task once", async () => {
    const q = new InMemoryTaskQueue();
    q.failOnce(task.name, new Error("unavailable"));
    await expect(q.enqueue(task)).rejects.toThrow("unavailable");
    expect(await q.enqueue(task)).toBe("enqueued");
  });
});
