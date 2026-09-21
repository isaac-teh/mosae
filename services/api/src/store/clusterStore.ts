import type { Firestore, WriteBatch } from "firebase-admin/firestore";
import { groupNearDuplicates } from "../cluster/duplicates.js";
import { clusterByTime } from "../cluster/timeClusters.js";
import { READY_STATUS, readinessOf, type ProjectOutcome } from "../domain/readiness.js";
import type { Asset } from "./finalizeStore.js";
import { gatherFacts } from "./readinessStore.js";

const BATCH_SIZE = 400;

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
  const oldEvents = await projectRef.collection("events").get();
  const writes: Write[] = oldEvents.docs.map((doc) => (batch) => batch.delete(doc.ref));

  if (readiness.outcome === "failed") {
    writes.push((batch) => batch.update(projectRef, { status: "failed", eventCount: 0, dateRange: null, readyAt: null }));
    await commit(db, writes);
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

  for (const event of events) {
    const { assetIds, ...fields } = event;
    writes.push((batch) => batch.set(projectRef.collection("events").doc(event.id), { ...fields, assetCount: assetIds.length }));
  }
  for (const asset of assets) {
    writes.push((batch) =>
      batch.update(projectRef.collection("assets").doc(asset.id), { eventId: eventOf.get(asset.id) ?? null, dupOf: primaryOf.get(asset.id) ?? null }),
    );
  }

  const dates = events.filter((event) => event.date !== null).map((event) => event.date as string);
  const dateRange = dates.length > 0 ? { start: dates[0], end: dates[dates.length - 1] } : null;
  writes.push((batch) => batch.update(projectRef, { status: readiness.outcome, eventCount: events.length, dateRange, readyAt: now }));

  await commit(db, writes);
  return { status: readiness.outcome, events: events.length, duplicates: primaryOf.size };
}
