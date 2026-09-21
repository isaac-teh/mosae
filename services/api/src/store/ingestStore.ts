import type { Firestore } from "firebase-admin/firestore";
import { canTransition } from "../domain/assetStatus.js";
import { PIPELINE_VERSION } from "../domain/ids.js";
import type { Derivatives, MediaFacts, MediaKind, QualityFacts } from "../domain/media.js";
import type { ShotRange } from "../ingest/shots.js";
import type { Asset } from "./finalizeStore.js";

export const shotId = (assetId: string, index: number): string => `${assetId}_${String(index).padStart(4, "0")}`;

/** Source identity plus timing. Photos carry no interval; videos carry it in the original's timebase. */
export type ShotRecord = {
  id: string;
  index: number;
  assetId: string;
  assetGeneration: string;
  mediaType: MediaKind;
  analysisVersion: number;
  sourceStartSec: number | null;
  sourceEndSec: number | null;
};

export function shotRecords(input: { assetId: string; generation: string; media: MediaFacts; ranges: ShotRange[] }): ShotRecord[] {
  const base = { assetId: input.assetId, assetGeneration: input.generation, mediaType: input.media.kind, analysisVersion: PIPELINE_VERSION };
  if (input.media.kind === "photo") {
    return [{ id: shotId(input.assetId, 0), index: 0, ...base, sourceStartSec: null, sourceEndSec: null }];
  }
  return input.ranges.map((range, index) => ({
    id: shotId(input.assetId, index),
    index,
    ...base,
    sourceStartSec: range.startSec,
    sourceEndSec: range.endSec,
  }));
}

export type IngestCommit = {
  projectId: string;
  assetId: string;
  generation: string;
  media: MediaFacts;
  quality: QualityFacts;
  derivatives: Derivatives;
  ranges: ShotRange[];
  now: number;
};

const assetRef = (db: Firestore, projectId: string, assetId: string) =>
  db.collection("projects").doc(projectId).collection("assets").doc(assetId);

export async function loadAsset(db: Firestore, projectId: string, assetId: string): Promise<Asset | null> {
  const snap = await assetRef(db, projectId, assetId).get();
  return snap.exists ? (snap.data() as Asset) : null;
}

/**
 * One transaction writes the asset result and every shot, so a reader never sees
 * an ingested asset without its shots. The status check makes a retry harmless:
 * an asset that already ingested is skipped, not rewritten. Shot ids are
 * deterministic, so even a lost race could only rewrite the same documents.
 */
export async function commitIngested(db: Firestore, commit: IngestCommit): Promise<"ingested" | "skipped"> {
  const ref = assetRef(db, commit.projectId, commit.assetId);
  const shotsCollection = db.collection("projects").doc(commit.projectId).collection("shots");
  const records = shotRecords({ assetId: commit.assetId, generation: commit.generation, media: commit.media, ranges: commit.ranges });

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "skipped";
    const asset = snap.data() as Asset;
    if (asset.generation !== commit.generation || !canTransition(asset.status, "ingested")) return "skipped";

    tx.update(ref, {
      status: "ingested",
      media: commit.media,
      quality: commit.quality,
      derivatives: commit.derivatives,
      ingestedAt: commit.now,
      updatedAt: commit.now,
      pipelineVersion: PIPELINE_VERSION,
      failureReason: null,
    });
    for (const record of records) tx.set(shotsCollection.doc(record.id), record);
    return "ingested";
  });
}

export async function commitFailed(
  db: Firestore,
  input: { projectId: string; assetId: string; generation: string; reason: string; now: number },
): Promise<"failed" | "skipped"> {
  const ref = assetRef(db, input.projectId, input.assetId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "skipped";
    const asset = snap.data() as Asset;
    if (asset.generation !== input.generation || asset.status !== "uploaded") return "skipped";
    tx.update(ref, { status: "failed", failureReason: input.reason, updatedAt: input.now });
    return "failed";
  });
}
