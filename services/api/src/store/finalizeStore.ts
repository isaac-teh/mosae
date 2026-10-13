import type { Firestore } from "firebase-admin/firestore";
import { parseOriginalPath, PIPELINE_VERSION } from "../domain/ids.js";
import { applyEntryEvent, type ManifestEntry } from "../domain/uploadSession.js";
import { canTransition, type AssetStatus } from "../domain/assetStatus.js";
import { newOutboxTask } from "../domain/outbox.js";
import type { Derivatives, MediaFacts, QualityFacts } from "../domain/media.js";
import type { TranscriptLine } from "../domain/understanding.js";
import type { Place } from "../understand/place.js";

export type FinalizeInput = {
  bucket: string;
  objectName: string;
  generation: string;
  sizeBytes: number;
  contentType: string;
  now: number;
};

export type FinalizeResult =
  | { kind: "ignored_path" }
  | { kind: "ignored_demo" }
  | { kind: "wrong_bucket" }
  | { kind: "unregistered" }
  | { kind: "rejected"; reason: "size_mismatch" | "not_pending" }
  | { kind: "duplicate" }
  | { kind: "stale" }
  | { kind: "accepted"; assetId: string; taskId: string };

export type Asset = {
  id: string;
  projectId: string;
  userId: string;
  sessionId: string;
  storagePath: string;
  generation: string;
  contentType: string;
  sizeBytes: number;
  fileName: string;
  status: AssetStatus;
  pipelineVersion: number;
  failureReason: string | null;
  createdAt: number;
  updatedAt: number;
  media?: MediaFacts;
  place?: Place | null;
  quality?: QualityFacts;
  derivatives?: Derivatives;
  ingestedAt?: number;
  transcript?: TranscriptLine[] | null;
  understoodAt?: number;
  /** Set by the project pass. */
  eventId?: string | null;
  dupOf?: string | null;
};

export async function recordFinalize(db: Firestore, expectedBucket: string, input: FinalizeInput): Promise<FinalizeResult> {
  const path = parseOriginalPath(input.objectName);
  if (!path) return { kind: "ignored_path" };
  if (input.bucket !== expectedBucket) return { kind: "wrong_bucket" };

  const projectRef = db.collection("projects").doc(path.projectId);
  const sessionRef = projectRef.collection("uploadSessions").doc(path.sessionId);
  const entryRef = sessionRef.collection("entries").doc(path.assetId);
  const assetRef = projectRef.collection("assets").doc(path.assetId);
  const task = newOutboxTask({
    projectId: path.projectId,
    subjectKind: "asset",
    subjectId: path.assetId,
    generation: input.generation,
    stage: "ingest",
    now: input.now,
  });
  const taskRef = projectRef.collection("taskOutbox").doc(task.id);

  return db.runTransaction(async (tx) => {
    const [project, session, entrySnap, assetSnap, taskSnap] = await Promise.all([
      tx.get(projectRef),
      tx.get(sessionRef),
      tx.get(entryRef),
      tx.get(assetRef),
      tx.get(taskRef),
    ]);
    if (!project.exists || project.get("userId") !== path.userId || project.get("deleting") === true) return { kind: "unregistered" };
    if (project.get("demo") === "trip1-v2") return { kind: "ignored_demo" };
    if (!session.exists || !entrySnap.exists) return { kind: "unregistered" };

    const entry = entrySnap.data() as ManifestEntry;
    if (entry.outcome === "cancelled" || entry.outcome === "failed") return { kind: "rejected", reason: "not_pending" };
    if (entry.generation === input.generation) return { kind: "duplicate" };

    if (entry.sizeBytes !== input.sizeBytes) {
      tx.set(entryRef, applyEntryEvent(entry, { kind: "failed", reason: "size_mismatch" }).entry);
      return { kind: "rejected", reason: "size_mismatch" };
    }

    const currentStatus = assetSnap.exists ? (assetSnap.get("status") as AssetStatus) : null;
    if (!canTransition(currentStatus, "uploaded")) return { kind: "stale" };

    const finalized = applyEntryEvent(entry, { kind: "finalized", generation: input.generation });
    if (!finalized.changed) return { kind: "stale" };

    const asset: Asset = {
      id: path.assetId,
      projectId: path.projectId,
      userId: path.userId,
      sessionId: path.sessionId,
      storagePath: input.objectName,
      generation: input.generation,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      fileName: entry.fileName,
      status: "uploaded",
      pipelineVersion: PIPELINE_VERSION,
      failureReason: null,
      createdAt: assetSnap.exists ? (assetSnap.get("createdAt") as number) : input.now,
      updatedAt: input.now,
    };
    tx.set(entryRef, finalized.entry);
    tx.set(assetRef, asset);
    if (project.get("status") === "collecting") tx.update(projectRef, { status: "processing" });
    if (!taskSnap.exists) tx.create(taskRef, task);
    return { kind: "accepted", assetId: path.assetId, taskId: task.id };
  });
}
