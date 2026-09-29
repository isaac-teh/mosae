import type { Firestore } from "firebase-admin/firestore";
import type { Generation } from "@mosae/contracts";
import { markSaved, resetRender, setRenderProgress } from "../store/generationStore.js";
import { renderOutputPath } from "./dispatchRender.js";

export type RenderCallbackEvent =
  | { kind: "progress"; projectId: string; generationId: string; progress: number; revision?: number }
  | { kind: "complete"; projectId: string; generationId: string; outputPath: string; revision?: number }
  | { kind: "failed"; projectId: string; generationId: string; reason: string; revision?: number };

export type RenderCallbackResult = "updated" | "already_settled" | "skipped";

/** Apply an authenticated callback from mosae-render. Repeated Cloud Task callbacks are safe. */
export async function applyRenderCallback(db: Firestore, event: RenderCallbackEvent): Promise<RenderCallbackResult> {
  const project = db.collection("projects").doc(event.projectId);
  const [projectSnap, generationSnap] = await Promise.all([
    project.get(),
    project.collection("generations").doc(event.generationId).get(),
  ]);
  if (!projectSnap.exists || !generationSnap.exists) return "skipped";
  const userId = projectSnap.get("userId") as string;
  const generation = generationSnap.data() as Generation;
  const identity = { userId, projectId: event.projectId, generationId: event.generationId };

  if (event.revision !== undefined) {
    const generationRef = project.collection("generations").doc(event.generationId);
    const currentRef = generationRef.collection("edits").doc("current");
    const revisionRef = currentRef.collection("revisions").doc(String(event.revision));
    const outputPath = renderOutputPath(userId, event.projectId, event.generationId, event.revision);
    if (event.kind === "complete" && event.outputPath !== outputPath) throw new Error("render callback output path does not match the edit revision");
    return db.runTransaction(async (tx) => {
      const [current, revision] = await Promise.all([tx.get(currentRef), tx.get(revisionRef)]);
      if (!revision.exists) return "skipped";
      if (event.kind === "complete" && revision.get("status") === "ready" && revision.get("outputPath") === outputPath) return "already_settled";
      if (revision.get("status") !== "rendering") return "already_settled";
      const fields = event.kind === "progress"
        ? { renderProgress: event.progress }
        : event.kind === "complete"
          ? { status: "ready", renderProgress: 1, outputPath }
          : { status: "failed", error: event.reason };
      tx.update(revisionRef, fields);
      if (current.exists && current.get("renderRevision") === event.revision && ["rendering", "ready"].includes(String(current.get("status")))) {
        tx.update(currentRef, fields);
      }
      return "updated";
    });
  }

  if (event.kind === "progress") {
    if (generation.status !== "rendering") return "skipped";
    await setRenderProgress(db, { ...identity, progress: event.progress });
    return "updated";
  }

  const expectedPath = renderOutputPath(userId, event.projectId, event.generationId);
  if (event.kind === "complete") {
    if (event.outputPath !== expectedPath) throw new Error("render callback output path does not match the generation");
    if (generation.status === "saved" && generation.outputPath === expectedPath) return "already_settled";
    if (generation.status !== "rendering") return "skipped";
    if (generation.renderProgress < 1) await setRenderProgress(db, { ...identity, progress: 1 });
    await markSaved(db, { ...identity, outputPath: expectedPath });
    return "updated";
  }

  if (generation.status !== "rendering") return "already_settled";
  await resetRender(db, { ...identity, reasons: [event.reason] });
  return "updated";
}
