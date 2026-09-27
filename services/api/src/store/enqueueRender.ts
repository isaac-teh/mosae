import type { Firestore } from "firebase-admin/firestore";
import { startRender } from "./generationStore.js";
import { newOutboxTask } from "../domain/outbox.js";

/**
 * Start a render for a playable generation and write its `render` outbox task,
 * reusing the exact code path of `POST …/render` in `routes/generations.ts`.
 *
 * The route calls this so compose success can enqueue a render too: a playable
 * film is rendered automatically (Task 7's ruling), and Save still works because
 * `startRender` refuses anything but a playable generation, so a second render
 * cannot start on top of a running one. In production the dispatcher picks up
 * the task it writes; callers that enqueue from compose pass no dispatch seam —
 * they rely on the same drain the route already performs.
 */
export async function enqueueRender(
  db: Firestore,
  input: { userId: string; projectId: string; generationId: string; schemaVersion: number },
): Promise<void> {
  await startRender(db, {
    userId: input.userId,
    projectId: input.projectId,
    generationId: input.generationId,
  });

  const task = newOutboxTask({
    projectId: input.projectId,
    subjectKind: "generation",
    subjectId: input.generationId,
    generation: String(input.schemaVersion),
    stage: "render",
    now: Date.now(),
  });
  await db.collection("projects").doc(input.projectId).collection("taskOutbox").doc(task.id).set(task);
}
