import type { ManifestEntry } from "../domain/uploadSession.js";
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
  const pendingCounts = await Promise.all(sessions.docs.map((session) => session.ref.collection("entries").where("outcome", "==", "pending").count().get()));
  const pendingEntries = pendingCounts.reduce((sum, count) => sum + count.data().count, 0);
  for (const session of sessions.docs) {
    if (!session.get("closed")) openSessions += 1;
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
  await db.collection("projects").doc(projectId).collection("readiness").doc("summary").set({
    ...facts,
    settled: readiness.settled,
    outcome: readiness.settled ? readiness.outcome : null,
    updatedAt: now,
  });
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
export async function gatherSummaryUpload(db: Firestore, projectId: string, assets: { id?: string; status: string; media?: { kind?: string }; facts?: { kind?: string } }[]) {
  const sessions = await db.collection("projects").doc(projectId).collection("uploadSessions").get();
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const manifests = await Promise.all(sessions.docs.map(async (session) => ({ session, entries: (await session.ref.collection("entries").get()).docs.map((entry) => ({ ...entry.data(), assetId: entry.id, projectId, sessionId: session.id, logicalAssetId: entry.get("logicalAssetId") ?? entry.id }) as ManifestEntry) })));
  const allEntries = manifests.flatMap(({ entries }) => entries);
  const legacyReplaced = allEntries.flatMap((entry) => entry.outcome === "finalized" && entry.replacesAssetId ? [entry.replacesAssetId] : []);
  const superseded = new Set([...allEntries.flatMap((entry) => entry.replacementSuccessorId ? [entry.assetId] : []), ...legacyReplaced]);
  const effectiveEntries = allEntries.filter((entry) => !superseded.has(entry.assetId));
  const upload = { expected: effectiveEntries.length, settled: 0, uploaded: 0, failed: 0, failedAssetIds: [] as string[], failedEntries: [] as { assetId: string; sessionId: string }[], pendingEntries: [] as { assetId: string; sessionId: string }[], processingFailed: assets.filter((asset) => asset.status === "failed").length, cancelled: 0, closed: sessions.docs.every((session) => session.get("closed") === true) };
  const excludedAssetIds: string[] = allEntries.filter((entry) => superseded.has(entry.assetId)).map((entry) => entry.assetId);
  let manifestReady = upload.closed && effectiveEntries.every((entry) => entry.outcome !== "pending");
  for (const entry of effectiveEntries) {
      if (entry.outcome === "failed" || entry.outcome === "cancelled") excludedAssetIds.push(entry.assetId);
      if (entry.outcome !== "pending") upload.settled += 1;
      if (entry.outcome === "finalized") upload.uploaded += 1;
      if (entry.outcome === "cancelled") upload.cancelled += 1;
      if (entry.outcome === "failed") { upload.failed += 1; upload.failedAssetIds.push(entry.assetId); upload.failedEntries.push({ assetId: entry.assetId, sessionId: entry.sessionId! }); }
      if (entry.outcome === "cancelled") upload.failedEntries.push({ assetId: entry.assetId, sessionId: entry.sessionId! });
      if (entry.outcome === "pending") upload.pendingEntries.push({ assetId: entry.assetId, sessionId: entry.sessionId! });
      const asset = byId.get(entry.assetId);
      const isVideo = (asset?.media ?? asset?.facts)?.kind === "video";
      if (!isVideo && entry.outcome === "finalized" && !["understood", "failed"].includes(asset?.status ?? "")) manifestReady = false;
  }
  return { upload, manifestReady, excludedAssetIds };
}
