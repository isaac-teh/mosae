import { sessionSettled, type ManifestEntry, type UploadSession } from "../domain/uploadSession.js";
import type { Firestore } from "firebase-admin/firestore";
import { newOutboxTask } from "../domain/outbox.js";
import { READY_STATUS, readinessOf, type ProjectFacts, type ProjectOutcome } from "../domain/readiness.js";

const ALREADY_EXISTS = 6;

/**
 * Progress and readiness come from server-side count aggregations rather than
 * counters on the project document. A counter would be one hot document written
 * by every concurrent ingest task; counts cost a couple of reads and have no
 * contention.
 */
export async function gatherFacts(db: Firestore, projectId: string): Promise<ProjectFacts> {
  const project = db.collection("projects").doc(projectId);
  const sessions = await project.collection("uploadSessions").get();

  let openSessions = 0;
  let pendingEntries = 0;
  for (const session of sessions.docs) {
    if (!session.get("closed")) openSessions += 1;
    const pending = await session.ref.collection("entries").where("outcome", "==", "pending").count().get();
    pendingEntries += pending.data().count;
  }

  const assets = project.collection("assets");
  const [all, ready, failed] = await Promise.all([
    assets.count().get(),
    assets.where("status", "==", READY_STATUS).count().get(),
    assets.where("status", "==", "failed").count().get(),
  ]);

  return {
    sessions: sessions.size,
    openSessions,
    pendingEntries,
    assets: all.data().count,
    ingested: ready.data().count,
    failed: failed.data().count,
  };
}

/**
 * Called after anything that can complete a project: an ingest finishing, a
 * session closing, an upload being cancelled. Whichever caller first sees the
 * settled state creates the cluster task; the deterministic document id makes
 * every other caller's create fail harmlessly, so the task exists exactly once
 * per asset count. New uploads change the count and therefore the key.
 */
export async function settleProject(
  db: Firestore,
  projectId: string,
  now: number,
): Promise<{ settled: boolean; enqueued: boolean; outcome: ProjectOutcome | null; facts: ProjectFacts }> {
  const facts = await gatherFacts(db, projectId);
  const readiness = readinessOf(facts);
  if (!readiness.settled) return { settled: false, enqueued: false, outcome: null, facts };

  const task = newOutboxTask({
    projectId,
    subjectKind: "project",
    subjectId: projectId,
    generation: String(facts.assets),
    stage: "cluster",
    now,
  });
  const ref = db.collection("projects").doc(projectId).collection("taskOutbox").doc(task.id);
  try {
    await ref.create(task);
    return { settled: true, enqueued: true, outcome: readiness.outcome, facts };
  } catch (error) {
    if ((error as { code?: number }).code === ALREADY_EXISTS) {
      return { settled: true, enqueued: false, outcome: readiness.outcome, facts };
    }
    throw error;
  }
}

/** Join every registered manifest entry to its asset, including files not yet registered. */
export async function gatherSummaryUpload(db: Firestore, projectId: string, assets: { id?: string; status: string }[]) {
  const sessions = await db.collection("projects").doc(projectId).collection("uploadSessions").get();
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const upload = { expected: 0, settled: 0, failed: assets.filter((asset) => asset.status === "failed").length, cancelled: 0, closed: true };
  const excludedAssetIds: string[] = [];
  let manifestReady = true;
  for (const session of sessions.docs) {
    const entries = await session.ref.collection("entries").get();
    const manifest = entries.docs.map((entry) => ({ ...entry.data(), assetId: entry.id })) as ManifestEntry[];
    upload.closed &&= session.get("closed") === true;
    manifestReady &&= sessionSettled({ closed: session.get("closed") === true } as UploadSession, manifest);
    for (const entry of manifest) {
      if (entry.outcome === "failed" || entry.outcome === "cancelled") excludedAssetIds.push(entry.assetId);
      upload.expected += 1;
      if (entry.outcome !== "pending") upload.settled += 1;
      if (entry.outcome === "cancelled") upload.cancelled += 1;
      if (entry.outcome === "failed" && byId.get(entry.assetId)?.status !== "failed") upload.failed += 1;
      if (entry.outcome === "finalized" && !["understood", "failed"].includes(byId.get(entry.assetId)?.status ?? "")) manifestReady = false;
    }
  }
  return { upload, manifestReady, excludedAssetIds };
}
