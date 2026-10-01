import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { VectorValue } from "@google-cloud/firestore";
import { canTransition } from "../domain/assetStatus.js";
import type { ShotAnalysis, TranscriptLine, Face, PhotoAnalysis } from "../domain/understanding.js";
import { characterIdFor } from "./directingStore.js";
import { DirectingStoreError } from "./directingStore.js";
import type { Asset } from "./finalizeStore.js";
const assetRef = (db: Firestore, projectId: string, assetId: string) => db.collection("projects").doc(projectId).collection("assets").doc(assetId);
const shotsCollection = (db: Firestore, projectId: string) => db.collection("projects").doc(projectId).collection("shots");
export type UnderstoodShot = { shotId: string; analysis: ShotAnalysis; embedding: number[] | null; faceEmbeddings?: Record<string, number[]> };
export type UnderstandCommit = { projectId: string; assetId: string; generation: string; shots: UnderstoodShot[]; transcript: TranscriptLine[] | null; now: number };
export async function commitUnderstood(db: Firestore, commit: UnderstandCommit): Promise<"understood" | "skipped"> {
  const ref = assetRef(db, commit.projectId, commit.assetId);
  return db.runTransaction(async (tx) => { const snap = await tx.get(ref); if (!snap.exists) return "skipped"; const asset = snap.data() as Asset; if (asset.generation !== commit.generation || !canTransition(asset.status, "understood")) return "skipped"; tx.update(ref, { status: "understood", transcript: commit.transcript, understoodAt: commit.now, updatedAt: commit.now }); for (const shot of commit.shots) { const data: Record<string, unknown> = { analysis: shot.analysis, embedding: shot.embedding === null ? null : FieldValue.vector(shot.embedding) }; data.faceEmbeddings = shot.faceEmbeddings && Object.keys(shot.faceEmbeddings).length > 0 ? Object.fromEntries(Object.entries(shot.faceEmbeddings).map(([faceId, vector]) => [faceId, FieldValue.vector(vector)])) : FieldValue.delete(); tx.update(shotsCollection(db, commit.projectId).doc(shot.shotId), data); } return "understood"; });
}
export async function commitUnderstandFailed(db: Firestore, input: { projectId: string; assetId: string; generation: string; reason: string; now: number }): Promise<"failed" | "skipped"> {
  const ref = assetRef(db, input.projectId, input.assetId); return db.runTransaction(async (tx) => { const snap = await tx.get(ref); if (!snap.exists) return "skipped"; const asset = snap.data() as Asset; if (asset.generation !== input.generation || asset.status !== "ingested") return "skipped"; tx.update(ref, { status: "failed", failureReason: input.reason, updatedAt: input.now }); return "failed"; });
}
export type ShotRef = { id: string; index: number; sourceStartSec: number | null; sourceEndSec: number | null };
export async function loadShotsForAsset(db: Firestore, projectId: string, assetId: string): Promise<ShotRef[]> { const snap = await shotsCollection(db, projectId).where("assetId", "==", assetId).orderBy("index").get(); return snap.docs.map((doc) => ({ id: doc.id, index: doc.get("index") as number, sourceStartSec: doc.get("sourceStartSec") as number | null, sourceEndSec: doc.get("sourceEndSec") as number | null })); }
export type SearchableShot = { id: string; assetId: string; embedding: number[] };
export async function loadSearchableShots(db: Firestore, projectId: string): Promise<SearchableShot[]> { const snap = await shotsCollection(db, projectId).get(); const out: SearchableShot[] = []; for (const doc of snap.docs) { const embedding = doc.get("embedding") as VectorValue | undefined; if (embedding) out.push({ id: doc.id, assetId: doc.get("assetId") as string, embedding: embedding.toArray() }); } return out; }

export type FaceAssignment = {
  faceId: string;
  characterId?: string;
  name?: string;
  role?: "MAIN" | "SUPPORTING";
};

/** Read every photo-face in a project, grouped by shot, with current
 *  assignments. Unassigned faces carry null identity fields so the UI can
 *  render an empty grid and know which crops still need a person. */
export async function getProjectFaces(
  db: Firestore,
  projectId: string,
): Promise<{ shotId: string; assetId: string; analysis?: PhotoAnalysis }[]> {
  const snap = await shotsCollection(db, projectId).get();
  const out: { shotId: string; assetId: string; analysis?: PhotoAnalysis }[] = [];
  for (const doc of snap.docs) {
    const analysis = doc.get("analysis") as ShotAnalysis | undefined;
    if (analysis && analysis.kind === "photo" && Array.isArray(analysis.faces)) {
      // The asset id, not the shot id, is what the thumbnail route signs, and
      // the picker needs that image to crop each face out of.
      out.push({ shotId: doc.id, assetId: doc.get("assetId") as string, analysis });
    }
  }
  return out;
}

/** Assign (or re-assign) a character to one stored face. Validates ownership
 *  of the project and existence of the shot + matching face before writing. */
export async function assignFaceCharacter(
  db: Firestore,
  input: { userId: string; projectId: string; shotId: string; assignment: FaceAssignment },
): Promise<Face> {
  const projectRef = db.collection("projects").doc(input.projectId);
  const shotRef = projectRef.collection("shots").doc(input.shotId);
  return db.runTransaction(async (tx) => {
    const [projectSnap, shotSnap] = await Promise.all([
      tx.get(projectRef),
      tx.get(shotRef),
    ]);
    if (!projectSnap.exists || projectSnap.get("userId") !== input.userId) {
      throw new DirectingStoreError("not_found");
    }
    if (!shotSnap.exists) throw new DirectingStoreError("not_found");

    const analysis = shotSnap.get("analysis") as ShotAnalysis | undefined;
    if (!analysis || analysis.kind !== "photo" || !Array.isArray(analysis.faces)) {
      throw new DirectingStoreError("invalid_face");
    }

    const faceIndex = analysis.faces.findIndex((f) => f.faceId === input.assignment.faceId);
    if (faceIndex === -1) throw new DirectingStoreError("not_found");

    const { name, role } = input.assignment;
    if (name !== undefined && name.trim().length === 0) {
      throw new DirectingStoreError("invalid_assignment");
    }
    if (role !== undefined && role !== "MAIN" && role !== "SUPPORTING") {
      throw new DirectingStoreError("invalid_assignment");
    }

    const characterId = input.assignment.characterId ?? (name ? characterIdFor(input.projectId, name) : undefined);
    const updated: Face = { ...analysis.faces[faceIndex], characterId };
    if (characterId && name) updated.name = name; else delete updated.name;
    if (role) updated.role = role; else delete updated.role;

    const faces = [...analysis.faces];
    faces[faceIndex] = updated;
    tx.update(shotRef, { analysis: { ...analysis, faces } });
    return updated;
  });
}
