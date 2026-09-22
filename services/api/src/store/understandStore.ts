import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { VectorValue } from "@google-cloud/firestore";
import { canTransition } from "../domain/assetStatus.js";
import type { ShotAnalysis, TranscriptLine } from "../domain/understanding.js";
import type { Asset } from "./finalizeStore.js";
const assetRef = (db: Firestore, projectId: string, assetId: string) => db.collection("projects").doc(projectId).collection("assets").doc(assetId);
const shotsCollection = (db: Firestore, projectId: string) => db.collection("projects").doc(projectId).collection("shots");
export type UnderstoodShot = { shotId: string; analysis: ShotAnalysis; embedding: number[] | null };
export type UnderstandCommit = { projectId: string; assetId: string; generation: string; shots: UnderstoodShot[]; transcript: TranscriptLine[] | null; now: number };
export async function commitUnderstood(db: Firestore, commit: UnderstandCommit): Promise<"understood" | "skipped"> {
  const ref = assetRef(db, commit.projectId, commit.assetId);
  return db.runTransaction(async (tx) => { const snap = await tx.get(ref); if (!snap.exists) return "skipped"; const asset = snap.data() as Asset; if (asset.generation !== commit.generation || !canTransition(asset.status, "understood")) return "skipped"; tx.update(ref, { status: "understood", transcript: commit.transcript, understoodAt: commit.now, updatedAt: commit.now }); for (const shot of commit.shots) tx.update(shotsCollection(db, commit.projectId).doc(shot.shotId), { analysis: shot.analysis, embedding: shot.embedding === null ? null : FieldValue.vector(shot.embedding) }); return "understood"; });
}
export async function commitUnderstandFailed(db: Firestore, input: { projectId: string; assetId: string; generation: string; reason: string; now: number }): Promise<"failed" | "skipped"> {
  const ref = assetRef(db, input.projectId, input.assetId); return db.runTransaction(async (tx) => { const snap = await tx.get(ref); if (!snap.exists) return "skipped"; const asset = snap.data() as Asset; if (asset.generation !== input.generation || asset.status !== "ingested") return "skipped"; tx.update(ref, { status: "failed", failureReason: input.reason, updatedAt: input.now }); return "failed"; });
}
export type ShotRef = { id: string; index: number; sourceStartSec: number | null; sourceEndSec: number | null };
export async function loadShotsForAsset(db: Firestore, projectId: string, assetId: string): Promise<ShotRef[]> { const snap = await shotsCollection(db, projectId).where("assetId", "==", assetId).orderBy("index").get(); return snap.docs.map((doc) => ({ id: doc.id, index: doc.get("index") as number, sourceStartSec: doc.get("sourceStartSec") as number | null, sourceEndSec: doc.get("sourceEndSec") as number | null })); }
export type SearchableShot = { id: string; assetId: string; embedding: number[] };
export async function loadSearchableShots(db: Firestore, projectId: string): Promise<SearchableShot[]> { const snap = await shotsCollection(db, projectId).get(); const out: SearchableShot[] = []; for (const doc of snap.docs) { const embedding = doc.get("embedding") as VectorValue | undefined; if (embedding) out.push({ id: doc.id, assetId: doc.get("assetId") as string, embedding: embedding.toArray() }); } return out; }
