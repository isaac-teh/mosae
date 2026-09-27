import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { getStorage } from "firebase-admin/storage";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminApp } from "../firebase/admin.js";
import type { Face, ShotAnalysis } from "../domain/understanding.js";
import { projectPhotoHashes, firestorePhotoHashDeps } from "./photoHash.js";
import { buildCast } from "./buildCast.js";
import { castSummary } from "./castSummary.js";
import { labelledIdentity, labelsCover, type LabelFile } from "./labelledIdentity.js";
import type { Cast, FaceRef, Interaction } from "./types.js";

export async function ensureCast(
  db: Firestore,
  projectId: string,
  opts: { labels?: LabelFile; storageBucket?: string } = {},
): Promise<{ cast: Cast; summary: string | null }> {
  const project = db.collection("projects").doc(projectId);
  const [shotSnaps, assetSnaps] = await Promise.all([
    project.collection("shots").get(), project.collection("assets").get(),
  ]);
  const assets = new Map(assetSnaps.docs.map((doc) => [doc.id, doc.data()]));
  const photoHashes = await projectPhotoHashes(
    firestorePhotoHashDeps(db, getStorage(getAdminApp()).bucket(opts.storageBucket ?? process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com")), projectId,
  );

  const faces: FaceRef[] = [];
  const interactions: Interaction[] = [];
  const refs = new Map<string, { shotId: string; index: number }>();
  for (const doc of shotSnaps.docs) {
    const data = doc.data();
    const asset = assets.get(data.assetId) as { generation?: number } | undefined;
    if (!asset || asset.generation !== data.assetGeneration) continue;
    const analysis = data.analysis as ShotAnalysis | undefined;
    if (analysis?.kind !== "photo") continue;
    const hash = photoHashes.get(data.assetId);
    if (!hash) continue;
    (analysis.faces ?? []).forEach((face: Face, index) => {
      faces.push({ faceId: face.faceId, shotId: doc.id, photoHash: hash, bbox: face.bbox, ageBand: face.ageBand, prominence: face.prominence });
      refs.set(face.faceId, { shotId: doc.id, index });
    });
    for (const interaction of analysis.interactions ?? []) interactions.push(interaction);
  }

  let labels = opts.labels;
  if (!labels) {
    const fixtureDirectory = fileURLToPath(new URL("../../fixtures/cast/", import.meta.url));
    const files = (await readdir(fixtureDirectory)).filter((file) => file.endsWith(".json")).sort();
    for (const file of files) {
      const candidate = JSON.parse(await readFile(resolve(fixtureDirectory, file), "utf8")) as LabelFile;
      if (labelsCover(candidate, [...photoHashes.values()])) { labels = candidate; break; }
    }
  }
  const resolver = labels ? labelledIdentity(labels) : null;
  const identities = resolver?.resolve(faces) ?? new Map<string, string>();
  const cast = buildCast({ faces, identities, interactions, source: resolver?.source ?? "none" });
  const summary = castSummary(cast, faces, identities);

  const batch = db.batch();
  batch.set(project.collection("cast").doc("current"), cast);
  const byShot = new Map<string, Face[]>();
  for (const [faceId, personId] of identities) {
    const ref = refs.get(faceId);
    if (!ref) continue;
    const original = shotSnaps.docs.find((doc) => doc.id === ref.shotId)?.get("analysis") as ShotAnalysis | undefined;
    if (!original || original.kind !== "photo") continue;
    const face = original.faces?.[ref.index];
    if (!face || face.name) continue;
    const next = byShot.get(ref.shotId) ?? [...(original.faces ?? [])];
    next[ref.index] = { ...next[ref.index]!, characterId: personId, role: cast.focus.includes(personId) ? "MAIN" : "SUPPORTING" };
    byShot.set(ref.shotId, next);
  }
  for (const [shotId, nextFaces] of byShot) {
    const doc = project.collection("shots").doc(shotId);
    const analysis = shotSnaps.docs.find((shot) => shot.id === shotId)!.get("analysis") as ShotAnalysis;
    batch.update(doc, { analysis: { ...analysis, faces: nextFaces } });
  }
  await batch.commit();
  return { cast, summary };
}
