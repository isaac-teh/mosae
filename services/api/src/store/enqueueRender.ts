import type { Firestore } from "firebase-admin/firestore";
import { getGeneration, startRender } from "./generationStore.js";
import { newOutboxTask } from "../domain/outbox.js";

/**
 * Start a render for a playable generation and write its `render` outbox task,
 * reusing the exact code path of `POST …/render` in `routes/generations.ts`.
 *
 * `startRender` refuses anything but a playable generation, so duplicate Save
 * requests join the existing render rather than writing another outbox task.
 */
export async function enqueueRender(
  db: Firestore,
  input: { userId: string; projectId: string; generationId: string; schemaVersion: number },
): Promise<void> {
  const current = await getGeneration(db, input.userId, input.projectId, input.generationId);
  if (!current) throw new Error("generation_not_found");
  if (current.status === "rendering" || current.status === "saved") return;

  try {
    await startRender(db, {
      userId: input.userId,
      projectId: input.projectId,
      generationId: input.generationId,
    });
  } catch (error) {
    // Two taps can both read `playable`; the transaction lets one start, then
    // the loser observes `rendering` and joins that in-flight render.
    const latest = await getGeneration(db, input.userId, input.projectId, input.generationId);
    if (latest?.status === "rendering" || latest?.status === "saved") return;
    throw error;
  }

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
