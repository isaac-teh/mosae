import type { Firestore } from "firebase-admin/firestore";
import { buildDerivativePath, buildOriginalPath, PIPELINE_VERSION } from "../domain/ids.js";
import { createProject, type Project } from "../store/projectStore.js";
import { loadDemoBundle } from "./bundle.js";

type DemoFile = { copy(destination: string): Promise<unknown> };
export type DemoBucket = { file(path: string): DemoFile };
export type DemoProject = Project & { demo: "trip1-v2" };

/** Copy with new ids and paths, then publish readiness only after every object and document exists. */
export async function createDemoProject(input: {
  db: Firestore; bucket: DemoBucket; userId: string; now: number;
}): Promise<DemoProject> {
  const startedAt = Date.now();
  const { db, bucket, userId, now } = input;
  const bundle = loadDemoBundle();
  const project = await createProject(db, { userId, mode: "memory", now });
  const ref = db.collection("projects").doc(project.id);
  await ref.update({ demo: "trip1-v2", status: "processing", demoLiveCalls: 0 });
  const sessionId = db.collection("_ids").doc().id;
  const ids = new Map<string, string>();
  // Firestore lists shots by document id. Preserve the source catalog's order
  // across fresh projects, including equal-score shots in one event; the
  // recorder's positional placeholders depend on that semantic order.
  const sourceOrder = new Map(bundle.photos.map((photo) => photo.sourceShotId).sort().map((id, index) => [id, index]));
  for (const photo of bundle.photos) {
    const assetId = `${String(sourceOrder.get(photo.sourceShotId)).padStart(2, "0")}_${db.collection("_ids").doc().id}`;
    ids.set(photo.sourceAssetId, assetId);
    ids.set(photo.sourceShotId, `${assetId}_0000`);
  }
  // Face ids contain the source shot id as a prefix. Replace long keys first,
  // so replacing an asset id cannot leave a stale suffix in a shot or face id.
  const replacements = [...ids].sort((a, b) => b[0].length - a[0].length);
  const remap = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, part) => {
    if (typeof part !== "string") return part;
    let result = part;
    for (const [oldId, newId] of replacements) result = result.replaceAll(oldId, newId);
    return result;
  })) as T;

  try {
    const copiedPhotos = await Promise.all(bundle.photos.map(async (photo) => {
      const assetId = ids.get(photo.sourceAssetId)!;
      const shotId = ids.get(photo.sourceShotId)!;
      const storagePath = buildOriginalPath({ userId, projectId: project.id, sessionId, assetId });
      const generation = photo.sourceGeneration;
      const owner = { userId, projectId: project.id, assetId, generation };
      const renderPath = buildDerivativePath(owner, "render.jpg");
      const thumbPath = buildDerivativePath(owner, "thumb.jpg");
      await Promise.all([
        bucket.file(`library/demo/trip1-v2/${photo.fileName}`).copy(storagePath),
        bucket.file(`library/demo/trip1-v2/variants/render/${photo.fileName}`).copy(renderPath),
        bucket.file(`library/demo/trip1-v2/variants/thumb/${photo.fileName}`).copy(thumbPath),
      ]);
      return { photo, assetId, shotId, storagePath, generation, renderPath, thumbPath };
    }));

    const batch = db.batch();
    for (const { photo, assetId, shotId, storagePath, generation, renderPath, thumbPath } of copiedPhotos) {
      batch.set(ref.collection("assets").doc(assetId), {
        id: assetId, projectId: project.id, userId, sessionId, storagePath, generation,
        contentType: "image/jpeg", sizeBytes: photo.sizeBytes, fileName: photo.fileName,
        status: "understood", pipelineVersion: PIPELINE_VERSION, failureReason: null,
        createdAt: now, updatedAt: now, ingestedAt: now, understoodAt: now,
        media: photo.media, place: photo.place, quality: photo.quality,
        transcript: null, eventId: photo.eventId,
        dupOf: photo.dupOf ? ids.get(photo.dupOf) ?? null : null,
        derivatives: { proxyPath: null, renderPath, thumbPath },
      });
      batch.set(ref.collection("shots").doc(shotId), {
        id: shotId, index: 0, assetId, assetGeneration: generation,
        mediaType: "photo", analysisVersion: 1, sourceStartSec: null,
        sourceEndSec: null, analysis: remap(photo.analysis),
      });
    }
    batch.set(ref.collection("cast").doc("current"), { ...remap(bundle.cast), confirmed: true });
    await batch.commit();
    await ref.update({ status: "ready", readyAt: now, dateRange: { start: "2026-06-01", end: "2026-06-03" } });
    console.info("demo_project_created", { projectId: project.id, elapsedMs: Date.now() - startedAt });
    return { ...project, demo: "trip1-v2", status: "ready" };
  } catch (error) {
    await ref.update({ status: "failed" });
    console.info("demo_project_failed", { projectId: project.id, elapsedMs: Date.now() - startedAt });
    throw error;
  }
}
