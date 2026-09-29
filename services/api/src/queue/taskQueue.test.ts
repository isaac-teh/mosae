import { describe, it, expect, vi } from "vitest";
import { CloudTasksQueue, InMemoryTaskQueue } from "./taskQueue.js";

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

describe("CloudTasksQueue", () => {
  it("can target a separate service with a structured render payload and OIDC token", async () => {
    const createTask = vi.fn().mockResolvedValue([{}]);
    const client = {
      queuePath: vi.fn().mockReturnValue("projects/p/locations/l/queues/q"),
      createTask,
    };
    const queue = new CloudTasksQueue({ project: "p", location: "l", queue: "q", serviceUrl: "https://render.example", invokerServiceAccount: "tasks@example.iam.gserviceaccount.com" }, client as never);

    await expect(queue.enqueuePayload({
      name: "render-key", path: "/tasks/render", body: { outputFile: "g1.mp4", job: { projectId: "p1" } },
    })).resolves.toBe("enqueued");
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      task: expect.objectContaining({
        httpRequest: expect.objectContaining({
          url: "https://render.example/tasks/render",
          oidcToken: { serviceAccountEmail: "tasks@example.iam.gserviceaccount.com", audience: "https://render.example" },
        }),
      }),
    }));
  });
});
