import { describe, expect, it } from "vitest";
import { adminDb } from "../firebase/admin.js";
import type { PhotoAnalysis } from "../domain/understanding.js";
import { commitUnderstandFailed, commitUnderstood, loadSearchableShots, loadShotsForAsset } from "./understandStore.js";

const analysis: PhotoAnalysis = { kind: "photo", caption: "beach", subjects: [], setting: "beach", activities: [], mood: "calm", shotType: "wide", aesthetics: 3, keyMomentScore: 3, tags: [] };
const id = () => crypto.randomUUID();
async function seed(projectId: string, assetId = "a1", status = "ingested") {
  await adminDb.doc(`projects/${projectId}/assets/${assetId}`).set({ id: assetId, projectId, generation: "7", status, createdAt: 1, updatedAt: 1 });
  await adminDb.doc(`projects/${projectId}/shots/${assetId}_0000`).set({ id: `${assetId}_0000`, assetId, index: 0, sourceStartSec: null, sourceEndSec: null });
}

describe("understanding store (emulator)", () => {
  it("atomically marks an ingested asset understood and persists a vector", async () => {
    const projectId = id(); await seed(projectId);
    await expect(commitUnderstood(adminDb, { projectId, assetId: "a1", generation: "7", shots: [{ shotId: "a1_0000", analysis, embedding: [0.1, 0.2] }], transcript: null, now: 2 })).resolves.toBe("understood");
    expect((await adminDb.doc(`projects/${projectId}/assets/a1`).get()).data()).toMatchObject({ status: "understood", transcript: null });
    const shots = await loadSearchableShots(adminDb, projectId);
    expect(shots).toEqual([{ id: "a1_0000", assetId: "a1", embedding: [0.1, 0.2] }]);
  });

  it("does not make an embedding for an empty analysis result", async () => {
    const projectId = id(); await seed(projectId);
    await commitUnderstood(adminDb, { projectId, assetId: "a1", generation: "7", shots: [{ shotId: "a1_0000", analysis, embedding: null }], transcript: null, now: 2 });
    await expect(loadSearchableShots(adminDb, projectId)).resolves.toEqual([]);
  });

  it("orders an asset's shots and does not overwrite a stale status", async () => {
    const projectId = id(); await seed(projectId, "a1", "uploaded");
    await adminDb.doc(`projects/${projectId}/shots/a1_0001`).set({ id: "a1_0001", assetId: "a1", index: 1, sourceStartSec: 1, sourceEndSec: 2 });
    await expect(commitUnderstandFailed(adminDb, { projectId, assetId: "a1", generation: "7", reason: "late", now: 2 })).resolves.toBe("skipped");
    await expect(loadShotsForAsset(adminDb, projectId, "a1").then((shots) => shots.map((shot) => shot.id))).resolves.toEqual(["a1_0000", "a1_0001"]);
  });
});
