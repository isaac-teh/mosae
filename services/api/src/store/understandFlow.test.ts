import { stat } from "node:fs/promises";
import { getStorage } from "firebase-admin/storage";
import { afterAll, describe, expect, it } from "vitest";
import { buildOriginalPath } from "../domain/ids.js";
import { adminDb, getAdminApp } from "../firebase/admin.js";
import { closeProbe } from "../ingest/probe.js";
import { firebaseObjectStore } from "../ingest/objectStore.js";
import { makeJpeg, makeSceneVideo, tempDir } from "../ingest/testMedia.js";
import { createIngest } from "../ingest/wire.js";
import { understandAsset, type UnderstandDeps } from "../understand/understandAsset.js";
import { rankShots } from "../understand/search.js";
import { runProjectPass } from "./clusterStore.js";
import { recordFinalize } from "./finalizeStore.js";
import { loadAsset } from "./ingestStore.js";
import { closeSession, createProject, openSession } from "./projectStore.js";
import { settleProject } from "./readinessStore.js";
import { commitUnderstandFailed, commitUnderstood, loadSearchableShots, loadShotsForAsset } from "./understandStore.js";

const BUCKET = "demo-mosae.appspot.com";
const photoAnalysis = { kind: "photo" as const, caption: "beach", subjects: [], setting: "beach", activities: [], mood: "calm", shotType: "wide", aesthetics: 4, keyMomentScore: 3, tags: ["beach"] };
const videoShot = (index: number) => ({ kind: "video" as const, description: `scene ${index}`, camera: "handheld", role: "A_ROLL" as const, subjects: ["child"], emotion: "happy", quality: 4, usable: true, reason: "clear" });

afterAll(async () => closeProbe());

describe("understand flow (emulators)", () => {
  it("takes a mixed upload through understanding, readiness and searchable vectors without Gemini", { timeout: 180_000 }, async () => {
    const media = await tempDir(); const bucket = getStorage(getAdminApp()).bucket(BUCKET); const objects = firebaseObjectStore(bucket);
    const photo = await makeJpeg(media.dir, "beach.jpg", { width: 640, height: 480 }); const video = await makeSceneVideo(media.dir, "clip.mp4", ["red", "blue"], 2);
    const inputs = [{ file: photo, fileName: "beach.jpg", contentType: "image/jpeg" }, { file: video, fileName: "clip.mp4", contentType: "video/mp4" }];
    const userId = `u-${crypto.randomUUID()}`; const project = await createProject(adminDb, { userId, mode: "memory", now: 1 });
    const { session, entries } = await openSession(adminDb, { userId, projectId: project.id, entries: await Promise.all(inputs.map(async (item) => ({ fileName: item.fileName, contentType: item.contentType, sizeBytes: (await stat(item.file)).size }))), now: 1 });
    const settle = async (projectId: string) => { await settleProject(adminDb, projectId, Date.now()); };
    const ingest = createIngest({ db: adminDb, bucketName: BUCKET, settle, dispatchDue: async () => undefined });
    for (const [index, input] of inputs.entries()) {
      const assetId = entries[index].assetId; const path = buildOriginalPath({ userId, projectId: project.id, sessionId: session.id, assetId });
      await bucket.upload(input.file, { destination: path, metadata: { contentType: input.contentType } }); const [metadata] = await bucket.file(path).getMetadata();
      await recordFinalize(adminDb, BUCKET, { bucket: BUCKET, objectName: path, generation: String(metadata.generation), sizeBytes: Number(metadata.size), contentType: input.contentType, now: 2 });
      await expect(ingest({ projectId: project.id, assetId, generation: String(metadata.generation) })).resolves.toBe("ingested");
    }
    await closeSession(adminDb, { userId, projectId: project.id, sessionId: session.id });
    const deps: UnderstandDeps = { loadAsset: (projectId, assetId) => loadAsset(adminDb, projectId, assetId), loadShots: (projectId, assetId) => loadShotsForAsset(adminDb, projectId, assetId), objects, analyzePhoto: async () => photoAnalysis, analyzeVideo: async ({ shotCount }) => ({ shots: Array.from({ length: shotCount }, (_, index) => videoShot(index)), transcript: [{ startSec: 0, endSec: 1, text: "hi" }] }), embedShots: async (shots) => shots.map((shot, index) => ({ shotId: shot.shotId, embedding: shot.analysis.kind === "photo" ? [1, 0] : [0, 1 + index] })), uploadVideoFile: async () => ({ name: "files/fake", uri: "gs://fake", mimeType: "video/mp4" }), deleteVideoFile: async () => undefined, commitUnderstood: (input) => commitUnderstood(adminDb, input), commitUnderstandFailed: (input) => commitUnderstandFailed(adminDb, input), settle, makeWorkDir: async () => (await tempDir()).dir, removeWorkDir: async () => undefined, now: () => 100 };
    const assets = await adminDb.collection(`projects/${project.id}/assets`).get();
    for (const asset of assets.docs) await expect(understandAsset(deps, { projectId: project.id, assetId: asset.id, generation: asset.get("generation") })).resolves.toBe("understood");
    expect((await loadAsset(adminDb, project.id, entries[0].assetId))?.transcript).toBeNull();
    expect((await loadAsset(adminDb, project.id, entries[1].assetId))?.transcript).toEqual([{ startSec: 0, endSec: 1, text: "hi" }]);
    await expect(runProjectPass(adminDb, project.id, Date.now())).resolves.toMatchObject({ status: "ready" });
    expect(rankShots([1, 0], await loadSearchableShots(adminDb, project.id), 1)[0].assetId).toBe(entries[0].assetId);
  });
});
