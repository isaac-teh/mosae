import { FieldValue, type Firestore, type WriteBatch } from "firebase-admin/firestore";
import { groupNearDuplicates } from "../cluster/duplicates.js";
import { clusterByTime } from "../cluster/timeClusters.js";
import { READY_STATUS, readinessOf, type ProjectOutcome } from "../domain/readiness.js";
import type { Asset } from "./finalizeStore.js";
import { gatherFacts } from "./readinessStore.js";

const BATCH_SIZE = 400;
export const CLUSTER_LEASE_MS = 5 * 60_000;

type Write = (batch: WriteBatch) => void;

async function commit(db: Firestore, writes: Write[]): Promise<void> {
  for (let start = 0; start < writes.length; start += BATCH_SIZE) {
    const batch = db.batch();
    for (const write of writes.slice(start, start + BATCH_SIZE)) write(batch);
    await batch.commit();
  }
}

export type ProjectPassResult = { status: "skipped" } | { status: ProjectOutcome; events: number; duplicates: number };

/**
 * Re-derives everything from the assets, so running it twice, or after new
 * uploads, converges on the same result. It re-checks readiness itself: a task
 * queued for an earlier asset count must not cluster a project that has since
 * reopened for uploads.
 */
export async function runProjectPass(db: Firestore, projectId: string, now: number): Promise<ProjectPassResult> {
  const readiness = readinessOf(await gatherFacts(db, projectId));
  if (!readiness.settled) return { status: "skipped" };

  const projectRef = db.collection("projects").doc(projectId);
  const ownerId = crypto.randomUUID();
  const acquired = await db.runTransaction(async (transaction) => {
    const project = await transaction.get(projectRef);
    const lease = project.get("clusterLease") as { ownerId?: string; expiresAt?: number } | undefined;
    if (lease && typeof lease.expiresAt === "number" && lease.expiresAt > now) return false;
    transaction.update(projectRef, { clusterLease: { ownerId, expiresAt: now + CLUSTER_LEASE_MS } });
    return true;
  });
  if (!acquired) return { status: "skipped" };

  try {
    const oldEvents = await projectRef.collection("events").get();
    if (readiness.outcome === "failed") {
      await commit(db, oldEvents.docs.map((doc) => (batch) => batch.delete(doc.ref)));
      await commit(db, [(batch) => batch.update(projectRef, { status: "failed", eventCount: 0, dateRange: null, readyAt: null })]);
      return { status: "failed", events: 0, duplicates: 0 };
    }

    const snapshot = await projectRef.collection("assets").where("status", "==", READY_STATUS).get();
    const assets = snapshot.docs.map((doc) => doc.data() as Asset);

    const events = clusterByTime(assets.map((a) => ({ id: a.id, localTime: a.media?.localTime ?? null, createdAt: a.createdAt })));
    const groups = groupNearDuplicates(
      assets.map((a) => ({ id: a.id, kind: a.media?.kind ?? "photo", dHash: a.quality?.dHash ?? null, sharpness: a.quality?.sharpness ?? 0, localTime: a.media?.localTime ?? null })),
    );

    const eventOf = new Map<string, string>();
    for (const event of events) for (const id of event.assetIds) eventOf.set(id, event.id);
    const primaryOf = new Map<string, string>();
    for (const group of groups) for (const id of group.memberIds) primaryOf.set(id, group.primaryId);

    const eventWrites: Write[] = events.map((event) => {
      const { assetIds, ...fields } = event;
      return (batch) => batch.set(projectRef.collection("events").doc(event.id), { ...fields, assetCount: assetIds.length });
    });
    const assetWrites: Write[] = assets.map((asset) => (batch) =>
      batch.update(projectRef.collection("assets").doc(asset.id), { eventId: eventOf.get(asset.id) ?? null, dupOf: primaryOf.get(asset.id) ?? null }),
    );
    await commit(db, eventWrites);
    await commit(db, assetWrites);
    const eventIds = new Set(events.map((event) => event.id));
    await commit(db, oldEvents.docs.filter((doc) => !eventIds.has(doc.id)).map((doc) => (batch) => batch.delete(doc.ref)));

    const dates = events.filter((event) => event.date !== null).map((event) => event.date as string);
    const dateRange = dates.length > 0 ? { start: dates[0], end: dates[dates.length - 1] } : null;
    await commit(db, [(batch) => batch.update(projectRef, { status: readiness.outcome, eventCount: events.length, dateRange, readyAt: now })]);

    return { status: readiness.outcome, events: events.length, duplicates: primaryOf.size };
  } finally {
    await db.runTransaction(async (transaction) => {
      const project = await transaction.get(projectRef);
      if (project.get("clusterLease")?.ownerId === ownerId) transaction.update(projectRef, { clusterLease: FieldValue.delete() });
    });
  }
}
