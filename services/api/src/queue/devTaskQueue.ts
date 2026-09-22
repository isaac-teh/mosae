import type { IngestTask } from "../ingest/ingestAsset.js";
import type { UnderstandTask } from "../understand/understandAsset.js";
import type { QueuedTask, TaskQueue } from "./taskQueue.js";

export type DevTaskDeps = {
  ingest(task: IngestTask): Promise<unknown>;
  understand(task: UnderstandTask): Promise<unknown>;
  cluster(projectId: string): Promise<unknown>;
};

/**
 * Runs queued tasks in-process instead of delivering them to Cloud Tasks.
 * Local development only: the Storage emulator emits no finalize events and
 * nothing else drains the outbox, so without this every upload stays
 * "pending" forever. A task that throws is logged and dropped rather than
 * retried — this queue has no delivery guarantees, unlike Cloud Tasks.
 */
export class DevTaskQueue implements TaskQueue {
  private readonly seen = new Set<string>();

  constructor(private readonly deps: DevTaskDeps) {}

  async enqueue(task: QueuedTask): Promise<"enqueued" | "already_exists"> {
    if (this.seen.has(task.name)) return "already_exists";
    this.seen.add(task.name);
    try {
      await this.run(task);
      return "enqueued";
    } catch (error) {
      this.seen.delete(task.name);
      throw error;
    }
  }

  private async run(task: QueuedTask): Promise<void> {
    if (task.path === "/tasks/ingest") {
        const result = await this.deps.ingest({
          projectId: task.body.projectId,
          assetId: task.body.subjectId,
          generation: task.body.generation,
          attempt: 0,
        });
        console.log("dev ingest", task.name, result);
      } else if (task.path === "/tasks/understand") {
        const result = await this.deps.understand({
          projectId: task.body.projectId,
          assetId: task.body.subjectId,
          generation: task.body.generation,
          attempt: 0,
        });
        console.log("dev understand", task.name, result);
      } else if (task.path === "/tasks/cluster") {
        const result = await this.deps.cluster(task.body.projectId);
        console.log("dev cluster", task.name, result);
    } else {
      console.warn("dev task runner: unhandled task path", task.name, task.path);
    }
  }
}
