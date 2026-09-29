import { CloudTasksClient } from "@google-cloud/tasks";
import type { SubjectKind } from "../domain/ids.js";

export type QueuedTask = {
  name: string;
  path: string;
  body: { projectId: string; subjectKind: SubjectKind; subjectId: string; generation: string; workKey: string };
};

export interface TaskQueue {
  enqueue(task: QueuedTask): Promise<"enqueued" | "already_exists">;
}

export class InMemoryTaskQueue implements TaskQueue {
  readonly tasks: QueuedTask[] = [];
  private failures = new Map<string, Error>();

  failOnce(name: string, error: Error): void {
    this.failures.set(name, error);
  }

  async enqueue(task: QueuedTask): Promise<"enqueued" | "already_exists"> {
    const error = this.failures.get(task.name);
    if (error) {
      this.failures.delete(task.name);
      throw error;
    }
    if (this.tasks.some((t) => t.name === task.name)) return "already_exists";
    this.tasks.push(task);
    return "enqueued";
  }
}

const ALREADY_EXISTS = 6;

export class CloudTasksQueue implements TaskQueue {
  constructor(
    private config: { project: string; location: string; queue: string; serviceUrl: string; invokerServiceAccount: string },
    private client: Pick<CloudTasksClient, "queuePath" | "createTask"> = new CloudTasksClient(),
  ) {}

  async enqueue(task: QueuedTask): Promise<"enqueued" | "already_exists"> {
    return this.enqueuePayload(task);
  }

  async enqueuePayload(task: { name: string; path: string; body: Record<string, unknown> }): Promise<"enqueued" | "already_exists"> {
    const parent = this.client.queuePath(this.config.project, this.config.location, this.config.queue);
    try {
      await this.client.createTask({
        parent,
        task: {
          name: `${parent}/tasks/${task.name}`,
          httpRequest: {
            httpMethod: "POST",
            url: `${this.config.serviceUrl}${task.path}`,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(JSON.stringify(task.body)).toString("base64"),
            oidcToken: { serviceAccountEmail: this.config.invokerServiceAccount, audience: this.config.serviceUrl },
          },
        },
      });
      return "enqueued";
    } catch (error) {
      if ((error as { code?: number }).code === ALREADY_EXISTS) return "already_exists";
      throw error;
    }
  }
}
