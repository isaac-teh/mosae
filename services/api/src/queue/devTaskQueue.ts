import { AsyncLocalStorage } from "node:async_hooks";
import type { IngestTask } from "../ingest/ingestAsset.js";
import type { UnderstandTask } from "../understand/understandAsset.js";
import type { QueuedTask, TaskQueue } from "./taskQueue.js";
import type { PlanTask } from "../directing/wire.js";

export type DevTaskDeps = {
  ingest(task: IngestTask): Promise<unknown>;
  understand(task: UnderstandTask): Promise<unknown>;
  cluster(projectId: string): Promise<unknown>;
  plan?(task: PlanTask): Promise<unknown>;
};

/**
 * Runs queued tasks in-process instead of delivering them to Cloud Tasks.
 * Local development only: the Storage emulator emits no finalize events and
 * nothing else drains the outbox, so without this every upload stays
 * "pending" forever. Failed runs propagate to the outbox for redelivery.
 */
export class DevTaskQueue implements TaskQueue {
  private readonly seen = new Set<string>();
  private readonly running = new Map<string, { token: symbol; execution: Promise<void> }>();
  private readonly executionContext = new AsyncLocalStorage<ReadonlySet<symbol>>();

  constructor(private readonly deps: DevTaskDeps) {}

  async enqueue(task: QueuedTask): Promise<"enqueued" | "already_exists"> {
    if (this.seen.has(task.name)) return "already_exists";
    const pending = this.running.get(task.name);
    if (pending) {
      // Ingest can await another outbox drain after its dispatch lease expired.
      // That drain must retry this record, not wait on an ancestor on its own
      // stack or acknowledge the still-running work as delivered.
      if (this.executionContext.getStore()?.has(pending.token)) throw new Error("task_reentrant_delivery");
      // A run can outlive the outbox dispatch lease. A duplicate must await
      // its outcome before the second dispatcher may mark it delivered.
      await pending.execution;
      return "already_exists";
    }
    const token = Symbol(task.name);
    const ancestors = new Set(this.executionContext.getStore()).add(token);
    // Register the run before invoking user callbacks, including synchronous
    // reentry; tokens distinguish a new attempt from an old async context.
    const execution = Promise.resolve().then(() => this.executionContext.run(ancestors, () => this.run(task)));
    this.running.set(task.name, { token, execution });
    try {
      await execution;
      this.seen.add(task.name);
      return "enqueued";
    } finally {
      this.running.delete(task.name);
    }
  }

  private async run(task: QueuedTask): Promise<void> {
    if (task.path === "/tasks/plan") {
        if (!this.deps.plan) throw new Error("planning_not_configured");
        const result = await this.deps.plan({ projectId: task.body.projectId, jobId: task.body.subjectId, generation: task.body.generation });
        console.log("dev plan", task.name, result);
    } else if (task.path === "/tasks/ingest") {
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
