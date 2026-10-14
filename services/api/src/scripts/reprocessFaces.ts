import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";
import { getAdminApp } from "../firebase/admin.js";
import { clusterFaces, type FaceVector } from "../cast/clusterFaces.js";
import type { Face, PhotoAnalysis } from "../domain/understanding.js";
import { boxIou, createFaceService, FACE_EMBEDDING_MODEL } from "../understand/faceService.js";

export async function reprocessProjectFaces(projectId: string): Promise<Record<string, unknown>> {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucketName) throw new Error("FIREBASE_STORAGE_BUCKET is required");
  const service = createFaceService();
  if (!service) throw new Error("FACE_SERVICE_URL is required");
  const db = getFirestore(getAdminApp());
  const bucket = getStorage(getAdminApp()).bucket(bucketName);
  const project = db.collection("projects").doc(projectId);
  const [shots, assetsSnap, projectSnap] = await Promise.all([project.collection("shots").get(), project.collection("assets").get(), project.get()]);
  if (!projectSnap.exists) throw new Error(`project not found: ${projectId}`);
  const assets = new Map(assetsSnap.docs.map((doc) => [doc.id, doc.data()]));
  const people = (projectSnap.get("flow.people") as { personId?: string; name?: string; skipped?: boolean }[] | undefined) ?? [];
  const nameById = new Map(people.filter((person) => person.personId && person.name && !person.skipped).map((person) => [person.personId!, person.name!]));
  let processedPhotos = 0; let faceCount = 0;
  const vectors: FaceVector[] = []; const labels = new Map<string, string>();
  for (const doc of shots.docs) {
    const data = doc.data(); const analysis = data.analysis as PhotoAnalysis | undefined;
    if (analysis?.kind !== "photo") continue;
    const asset = assets.get(data.assetId) as { derivatives?: { renderPath?: string } } | undefined;
    if (!asset?.derivatives?.renderPath) continue;
    const [image] = await bucket.file(asset.derivatives.renderPath).download();
    const found = await service(await sharp(image).jpeg({ quality: 92 }).toBuffer());
    const prior = analysis.faces ?? []; const used = new Set<number>();
    const sorted = [...found].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
    const nextFaces: Face[] = sorted.map((face, index) => {
      const best = prior.map((candidate, i) => ({ candidate, i, score: boxIou(face.bbox, candidate.bbox) })).filter(({ i }) => !used.has(i)).sort((a, b) => b.score - a.score)[0];
      const metadata = best && best.score >= 0.08 ? best.candidate : undefined;
      if (best && metadata) used.add(best.i);
      const faceId = `${doc.id}-${index}`;
      if (metadata?.characterId) labels.set(faceId, nameById.get(metadata.characterId) ?? metadata.name ?? metadata.characterId);
      if ((face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1]) >= 0.01 && metadata?.prominence !== "background") vectors.push({ faceId, shotId: doc.id, vector: face.embedding, modelVersion: FACE_EMBEDDING_MODEL });
      return { ...(metadata ?? {}), faceId, bbox: face.bbox, confidence: face.detScore };
    });
    const faceEmbeddings = Object.fromEntries(sorted.map((face, index) => [`${doc.id}-${index}`, FieldValue.vector(face.embedding)]));
    await doc.ref.update({ analysis: { ...analysis, faces: nextFaces }, faceEmbeddings: Object.keys(faceEmbeddings).length ? faceEmbeddings : FieldValue.delete(), faceEmbeddingModel: Object.keys(faceEmbeddings).length ? FACE_EMBEDDING_MODEL : FieldValue.delete() });
    processedPhotos++; faceCount += nextFaces.length;
  }
  const groups = clusterFaces(vectors, { threshold: 0.35, minPhotos: 2 }).map((ids) => ({ faces: ids.length, people: [...new Set(ids.map((id) => labels.get(id)).filter(Boolean))] }));
  return { projectId, processedPhotos, faces: faceCount, modelVersion: FACE_EMBEDDING_MODEL, groups };
}

