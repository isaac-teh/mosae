import { describe, expect, it, vi } from "vitest";
import { DevTaskQueue } from "./devTaskQueue.js";
import type { QueuedTask } from "./taskQueue.js";

const assetTask: QueuedTask = {
  name: "p_asset_a_1_ingest_1",
  path: "/tasks/ingest",
  body: { projectId: "p", subjectKind: "asset", subjectId: "a", generation: "1", workKey: "p:asset:a:1:ingest:1" },
};

const projectTask: QueuedTask = {
  name: "p_project_p_1_cluster_1",
  path: "/tasks/cluster",
  body: { projectId: "p", subjectKind: "project", subjectId: "p", generation: "1", workKey: "p:project:p:1:cluster:1" },
};

const understandTask: QueuedTask = {
  name: "p_asset_a_1_understand_1",
  path: "/tasks/understand",
  body: { projectId: "p", subjectKind: "asset", subjectId: "a", generation: "1", workKey: "p:asset:a:1:understand:1" },
};

// Runs are fire-and-forget from enqueue(), so tests await this to let the
// microtask queue drain before asserting on the spies.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("DevTaskQueue", () => {
  it("routes plans by path and makes deferred jobs redeliverable", async () => {
    const plan = vi.fn().mockRejectedValueOnce(new Error("waiting_for_ready")).mockResolvedValue("published");
    const ingest = vi.fn();
    const understand = vi.fn();
    const queue = new DevTaskQueue({ ingest, understand, cluster: vi.fn(), plan });
    const task: QueuedTask = {
      name: "plan-job", path: "/tasks/plan",
      body: { projectId: "p", subjectKind: "job", subjectId: "j", generation: "2", workKey: "plan-job" },
    };
    await expect(queue.enqueue(task)).rejects.toThrow("waiting_for_ready");
    await expect(queue.enqueue(task)).resolves.toBe("enqueued");
    await expect(queue.enqueue(task)).resolves.toBe("already_exists");
    expect(plan).toHaveBeenCalledWith({ projectId: "p", jobId: "j", generation: "2" });
    expect(ingest).not.toHaveBeenCalled();
    expect(understand).not.toHaveBeenCalled();
  });
  it("routes an asset task to ingest with the subject as assetId", async () => {
    const ingest = vi.fn().mockResolvedValue("ingested");
    const cluster = vi.fn();
    const q = new DevTaskQueue({ ingest, understand: vi.fn(), cluster });

    expect(await q.enqueue(assetTask)).toBe("enqueued");
    await flush();

    expect(ingest).toHaveBeenCalledWith({ projectId: "p", assetId: "a", generation: "1", attempt: 0 });
    expect(cluster).not.toHaveBeenCalled();
  });

  it("routes a project task to cluster with the project id", async () => {
    const ingest = vi.fn();
    const cluster = vi.fn().mockResolvedValue(undefined);
    const q = new DevTaskQueue({ ingest, understand: vi.fn(), cluster });

    expect(await q.enqueue(projectTask)).toBe("enqueued");
    await flush();

    expect(cluster).toHaveBeenCalledWith("p");
    expect(ingest).not.toHaveBeenCalled();
  });

  it("routes understanding by task path, distinct from ingest on the same subject kind", async () => {
    const ingest = vi.fn();
    const understand = vi.fn().mockResolvedValue("understood");
    const q = new DevTaskQueue({ ingest, understand, cluster: vi.fn() });
    await q.enqueue(understandTask);
    await flush();
    expect(understand).toHaveBeenCalledWith({ projectId: "p", assetId: "a", generation: "1", attempt: 0 });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("deduplicates by task name", async () => {
    const ingest = vi.fn().mockResolvedValue("ingested");
    const q = new DevTaskQueue({ ingest, understand: vi.fn(), cluster: vi.fn() });

    expect(await q.enqueue(assetTask)).toBe("enqueued");
    expect(await q.enqueue(assetTask)).toBe("already_exists");
    await flush();

    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed worker run so outbox dispatch can redeliver it", async () => {
    const ingest = vi.fn().mockRejectedValue(new Error("boom"));
    const q = new DevTaskQueue({ ingest, understand: vi.fn(), cluster: vi.fn() });

    await expect(q.enqueue(assetTask)).rejects.toThrow("boom");
    await expect(q.enqueue(assetTask)).rejects.toThrow("boom");
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("does not acknowledge a duplicate delivery while its planning run can still fail", async () => {
    let reject!: (error: Error) => void;
    const plan = vi.fn().mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const q = new DevTaskQueue({ plan, ingest: vi.fn(), understand: vi.fn(), cluster: vi.fn() });
    const task: QueuedTask = { ...projectTask, name: "pending-plan", path: "/tasks/plan", body: { ...projectTask.body, subjectKind: "job" } };
    const first = q.enqueue(task);
    const repeated = q.enqueue(task);
    const failed = Promise.all([expect(first).rejects.toThrow("interrupted"), expect(repeated).rejects.toThrow("interrupted")]);
    await Promise.resolve();
    reject(new Error("interrupted"));
    await failed;
    expect(plan).toHaveBeenCalledTimes(1);
  });

  it("runs a render task in process, so local development can render", async () => {
    // Without a branch here a local render logged "unhandled task path" and was
    // marked delivered, leaving the generation stuck in `rendering` forever.
    const render = vi.fn().mockResolvedValue("rendered");
    const queue = new DevTaskQueue({ ingest: vi.fn(), understand: vi.fn(), cluster: vi.fn(), render });
    await queue.enqueue({
      name: "p_generation_g_1_render_1",
      path: "/tasks/render",
      body: { projectId: "p", subjectKind: "generation", subjectId: "g", generation: "1", workKey: "p:generation:g:1:render:1" },
    });
    await flush();
    expect(render).toHaveBeenCalledWith({ projectId: "p", generationId: "g" });
  });
});
