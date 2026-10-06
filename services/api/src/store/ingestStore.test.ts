import { describe, expect, it } from "vitest";
import { adminDb } from "../firebase/admin.js";
import type { MediaFacts, QualityFacts } from "../domain/media.js";
import { commitFailed, commitIngested, loadAsset, shotId, shotRecords } from "./ingestStore.js";

const photo: MediaFacts = { kind: "photo", width: 4, height: 3, durationSec: null, localTime: "2026-05-03T09:00:00", timeSource: "exif", gps: null, camera: null };
const video: MediaFacts = { kind: "video", width: 4, height: 3, durationSec: 5, localTime: null, timeSource: "none", gps: null, camera: null };
const quality: QualityFacts = { sharpness: 90, exposure: 120, blurry: false, dHash: "0f0f0f0f0f0f0f0f" };
const derivatives = { thumbPath: "proxies/u/p/a/7/thumb.jpg", renderPath: "proxies/u/p/a/7/render.jpg", proxyPath: null };

async function seedAsset(status = "uploaded", generation = "7") {
  const projectId = `p-${crypto.randomUUID()}`;
  const assetId = "a1";
  await adminDb.doc(`projects/${projectId}/assets/${assetId}`).set({ id: assetId, projectId, userId: "u", generation, status, createdAt: 1, updatedAt: 1 });
  return { projectId, assetId };
}
const shots = (projectId: string) => adminDb.collection(`projects/${projectId}/shots`).get();

describe("shotRecords", () => {
  it("makes one interval-less shot for a photo", () => {
    expect(shotRecords({ assetId: "a1", generation: "7", media: photo, ranges: [] })).toEqual([
      { id: "a1_0000", index: 0, assetId: "a1", assetGeneration: "7", mediaType: "photo", analysisVersion: 2, sourceStartSec: null, sourceEndSec: null },
    ]);
  });

  it("makes one ordered shot per range for a video, with source intervals", () => {
    const records = shotRecords({ assetId: "a1", generation: "7", media: video, ranges: [{ startSec: 0, endSec: 2 }, { startSec: 2, endSec: 5 }] });
    expect(records.map((r) => [r.id, r.sourceStartSec, r.sourceEndSec])).toEqual([
      ["a1_0000", 0, 2],
      ["a1_0001", 2, 5],
    ]);
    expect(shotId("a1", 12)).toBe("a1_0012");
  });
});

describe("commitIngested (emulator)", () => {
  it("records facts, derivatives and shots, and marks the asset ingested", async () => {
    const { projectId, assetId } = await seedAsset();
    const result = await commitIngested(adminDb, { projectId, assetId, generation: "7", media: video, place: null, quality, derivatives, ranges: [{ startSec: 0, endSec: 2 }, { startSec: 2, endSec: 5 }], now: 50 });
    expect(result).toBe("ingested");
    const asset = await loadAsset(adminDb, projectId, assetId);
    expect(asset).toMatchObject({ status: "ingested", media: { kind: "video" }, quality: { dHash: "0f0f0f0f0f0f0f0f" }, derivatives, ingestedAt: 50 });
    expect((await shots(projectId)).size).toBe(2);
  });

  it("writes a single interval-less shot for a photo", async () => {
    const { projectId, assetId } = await seedAsset();
    await commitIngested(adminDb, { projectId, assetId, generation: "7", media: photo, place: null, quality, derivatives, ranges: [], now: 50 });
    const all = await shots(projectId);
    expect(all.size).toBe(1);
    expect(all.docs[0].data()).toMatchObject({ mediaType: "photo", sourceStartSec: null, sourceEndSec: null });
  });

  it("does not enqueue a second understand task when the ingest delivery chains it inline", async () => {
    const { projectId, assetId } = await seedAsset();
    await commitIngested(adminDb, { projectId, assetId, generation: "7", media: photo, place: null, quality, derivatives, ranges: [], now: 50 }, false);
    expect((await adminDb.collection(`projects/${projectId}/taskOutbox`).where("stage", "==", "understand").get()).size).toBe(0);
  });

  it("is idempotent: a second commit is skipped and does not duplicate shots", async () => {
    const { projectId, assetId } = await seedAsset();
    const commit = { projectId, assetId, generation: "7", media: video, place: null, quality, derivatives, ranges: [{ startSec: 0, endSec: 5 }], now: 50 };
    expect(await commitIngested(adminDb, commit)).toBe("ingested");
    expect(await commitIngested(adminDb, { ...commit, now: 60 })).toBe("skipped");
    expect((await shots(projectId)).size).toBe(1);
    expect((await loadAsset(adminDb, projectId, assetId))?.ingestedAt).toBe(50);
  });

  it("skips a stale task for an older upload generation", async () => {
    const { projectId, assetId } = await seedAsset("uploaded", "9");
    expect(await commitIngested(adminDb, { projectId, assetId, generation: "7", media: photo, place: null, quality, derivatives, ranges: [], now: 50 })).toBe("skipped");
    expect((await loadAsset(adminDb, projectId, assetId))?.status).toBe("uploaded");
    expect((await shots(projectId)).size).toBe(0);
  });

  it("skips when the asset does not exist", async () => {
    expect(await commitIngested(adminDb, { projectId: "missing", assetId: "a1", generation: "7", media: photo, place: null, quality, derivatives, ranges: [], now: 1 })).toBe("skipped");
  });
});

describe("commitFailed (emulator)", () => {
  it("marks an uploaded asset failed with the reason", async () => {
    const { projectId, assetId } = await seedAsset();
    expect(await commitFailed(adminDb, { projectId, assetId, generation: "7", reason: "unsupported_image", now: 5 })).toBe("failed");
    expect(await loadAsset(adminDb, projectId, assetId)).toMatchObject({ status: "failed", failureReason: "unsupported_image" });
  });

  it("does not overwrite an asset that already ingested", async () => {
    const { projectId, assetId } = await seedAsset("ingested");
    expect(await commitFailed(adminDb, { projectId, assetId, generation: "7", reason: "late", now: 5 })).toBe("skipped");
    expect((await loadAsset(adminDb, projectId, assetId))?.status).toBe("ingested");
  });
});
