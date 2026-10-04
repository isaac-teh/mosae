import { afterEach, describe, expect, it, vi } from "vitest";
import { getStorage } from "firebase-admin/storage";
import { adminDb, getAdminApp } from "../firebase/admin.js";
import type { PhotoAnalysis } from "../domain/understanding.js";
import { sha256Hex } from "./photoHash.js";
import { ensureCast } from "./ensureCast.js";
import type { LabelFile } from "./labelledIdentity.js";
import sharp from "sharp";
import type { Asset } from "../store/finalizeStore.js";
import { ingestAsset, type IngestDeps } from "../ingest/ingestAsset.js";
import { commitIngested, loadAsset } from "../store/ingestStore.js";
import { commitUnderstood, loadShotsForAsset } from "../store/understandStore.js";
import { settleProject } from "../store/readinessStore.js";
import { settleReadyProject } from "../store/settledProject.js";

const bucket = getStorage(getAdminApp()).bucket(process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com");
const projects: string[] = [];
const paths: string[] = [];
afterEach(async () => {
  await Promise.all(projects.splice(0).map((id) => adminDb.recursiveDelete(adminDb.doc(`projects/${id}`))));
  await Promise.all(paths.splice(0).map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
});

describe("ensureCast emulator", () => {
  it("creates a resolvable cast from inline ingest when one child appears in three photos", async () => {
    const projectId = `ensure-cast-inline-${crypto.randomUUID()}`;
    projects.push(projectId);
    const project = adminDb.collection("projects").doc(projectId);
    await project.set({ id: projectId });
    await project.collection("uploadSessions").doc("session").set({ closed: true });

    const items: { asset: Asset; bytes: Buffer; path: string }[] = [];
    for (let index = 0; index < 3; index++) {
      const assetId = `asset-${index}`;
      const path = `ensure-cast/${projectId}/${assetId}.jpg`;
      paths.push(path);
      const bytes = await sharp({ create: { width: 80, height: 60, channels: 3, background: `#${(0x335577 + index * 0x111111).toString(16)}` } }).jpeg().toBuffer();
      await bucket.file(path).save(bytes);
      const asset: Asset = {
        id: assetId, projectId, userId: "u1", sessionId: "session", storagePath: path,
        generation: "1", contentType: "image/jpeg", sizeBytes: bytes.length, fileName: `${assetId}.jpg`,
        status: "uploaded", pipelineVersion: 1, failureReason: null, createdAt: 1, updatedAt: 1,
      };
      await project.collection("assets").doc(assetId).set(asset);
      items.push({ asset, bytes, path });
    }
    const analysisFor = (index: number): PhotoAnalysis => ({ kind: "photo", caption: "", subjects: [], setting: "", activities: [], mood: "", shotType: "", aesthetics: 1, keyMomentScore: 1, tags: [], faces: [{ faceId: `asset-${index}_0000-0`, bbox: [0.2, 0.2, 0.7, 0.7], confidence: 1, ageBand: "child" }] });
    const labels: LabelFile = {
      people: { child: {} },
      photos: Object.fromEntries(items.map(({ bytes }) => [sha256Hex(bytes), [{ bbox: [0.2, 0.2, 0.7, 0.7], personId: "child" }]])),
    };
    const ensure = vi.fn((id: string) => ensureCast(adminDb, id, { labels, storageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com" }));
    const settle = async (id: string): Promise<void> => {
      await settleReadyProject({
        projectId: id,
        settle: (settleId) => settleProject(adminDb, settleId, Date.now()),
        ensureCast: ensure,
        dispatchDue: async () => undefined,
      });
    };

    for (const [index, { asset }] of items.entries()) {
      const analysis = analysisFor(index);
      const deps: IngestDeps = {
        loadAsset: (id, assetId) => loadAsset(adminDb, id, assetId),
        objects: { download: async () => undefined, downloadCurrent: async () => undefined, upload: async () => undefined },
        probe: async () => ({ kind: "photo", width: 80, height: 60, durationSec: null, localTime: null, timeSource: "none", gps: null, camera: null }),
        photoDerivatives: async () => ({ thumb: "/tmp/thumb.jpg", render: "/tmp/render.jpg" }),
        videoDerivatives: async () => ({ thumb: "/tmp/thumb.jpg", proxy: "/tmp/proxy.mp4" }),
        analyze: async () => ({ sharpness: 80, exposure: 120, blurry: false, dHash: "00ff00ff00ff00ff" }),
        detectShots: async () => [],
        commitIngested: (commit, enqueueUnderstand) => commitIngested(adminDb, commit, enqueueUnderstand),
        understand: async (task) => {
          const shots = await loadShotsForAsset(adminDb, task.projectId, task.assetId);
          return commitUnderstood(adminDb, { projectId: task.projectId, assetId: task.assetId, generation: task.generation, shots: shots.map((shot) => ({ shotId: shot.id, analysis, embedding: null })), transcript: null, now: Date.now() });
        },
        commitFailed: async () => "failed",
        settle,
        dispatchDue: async () => undefined,
        makeWorkDir: async () => "/tmp/inline-ingest",
        removeWorkDir: async () => undefined,
        maxBytes: 10_000_000,
        now: Date.now,
      };
      await expect(ingestAsset(deps, { projectId, assetId: asset.id, generation: asset.generation })).resolves.toBe("ingested");
    }

    expect(ensure).toHaveBeenCalledTimes(1);
    expect((await project.collection("cast").doc("current").get()).get("people")).toEqual(expect.arrayContaining([expect.objectContaining({ personId: "child" })]));
    expect((await project.collection("assets").where("status", "==", "understood").get()).size).toBe(3);
    const assignedFaces = await project.collection("shots").get();
    expect(assignedFaces.docs.map((shot) => (shot.get("analysis") as PhotoAnalysis).faces?.[0]?.characterId)).toEqual(["child", "child", "child"]);
  });

  it("persists identified faces and preserves a named face assignment", async () => {
    const projectId = `ensure-cast-${crypto.randomUUID()}`;
    projects.push(projectId);
    const project = adminDb.collection("projects").doc(projectId);
    await project.set({ id: projectId });
    const photos = new Map<string, LabelFile["photos"][string]>();
    for (let shotIndex = 0; shotIndex < 3; shotIndex++) {
      const assetId = `asset-${shotIndex}`;
      const path = `ensure-cast/${projectId}/${assetId}.jpg`;
      paths.push(path);
      const bytes = Buffer.from(`photo-${shotIndex}`);
      await bucket.file(path).save(bytes);
      const hash = sha256Hex(bytes);
      const faceData = [
        { faceId: `shot-${shotIndex}-adult1`, bbox: [0.1, 0.1, 0.3, 0.3] as [number, number, number, number], ageBand: "adult" as const },
        { faceId: `shot-${shotIndex}-adult2`, bbox: [0.4, 0.1, 0.6, 0.3] as [number, number, number, number], ageBand: "adult" as const },
        { faceId: `shot-${shotIndex}-child`, bbox: [0.7, 0.1, 0.9, 0.3] as [number, number, number, number], ageBand: "child" as const },
      ];
      const analysis: PhotoAnalysis = { kind: "photo", caption: "", subjects: [], setting: "", activities: [], mood: "", shotType: "", aesthetics: 1, keyMomentScore: 1, tags: [], faces: faceData.map((face) => ({ ...face, confidence: 1 })) };
      if (shotIndex === 0) analysis.faces![0] = { ...analysis.faces![0]!, name: "Human name", characterId: "human-assigned-id" };
      await project.collection("assets").doc(assetId).set({ id: assetId, storagePath: path, fileName: `${assetId}.jpg`, mediaType: "photo", generation: 1 });
      await project.collection("shots").doc(`shot-${shotIndex}`).set({ id: `shot-${shotIndex}`, assetId, assetGeneration: 1, analysis });
      photos.set(hash, faceData.map(({ bbox }, index) => ({ bbox, personId: ["A", "B", "C"][index]! })));
    }
    const labels: LabelFile = { people: {}, photos: Object.fromEntries(photos) };
    const { cast } = await ensureCast(adminDb, projectId, { labels, storageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com" });
    expect(cast.core).toHaveLength(3);
    expect((await project.collection("cast").doc("current").get()).get("core")).toHaveLength(3);
    const child = ((await project.collection("shots").doc("shot-0").get()).data()!.analysis as PhotoAnalysis).faces![2];
    expect(child).toMatchObject({ characterId: "C", role: "MAIN" });
    const named = ((await project.collection("shots").doc("shot-0").get()).data()!.analysis as PhotoAnalysis).faces![0];
    expect(named).toMatchObject({ name: "Human name", characterId: "human-assigned-id" });

    const confirmed = { ...cast, confirmed: true, people: cast.people.map((person) => person.personId === "A" ? { ...person, name: "Papa" } : person) };
    await project.collection("cast").doc("current").set(confirmed);
    const newAnalysis: PhotoAnalysis = { kind: "photo", caption: "new upload", subjects: [], setting: "", activities: [], mood: "", shotType: "", aesthetics: 1, keyMomentScore: 1, tags: [], faces: [{ faceId: "new-face", bbox: [0.2, 0.2, 0.7, 0.7], confidence: 1 }] };
    await project.collection("shots").doc("new-upload").set({ id: "new-upload", assetId: "asset-0", assetGeneration: 1, analysis: newAnalysis });
    const beforeCast = (await project.collection("cast").doc("current").get()).data();
    const beforeNewShot = (await project.collection("shots").doc("new-upload").get()).data();
    const kept = await ensureCast(adminDb, projectId, { labels, storageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com" });
    expect(kept.cast.people.find((person) => person.personId === "A")?.name).toBe("Papa");
    expect((await project.collection("cast").doc("current").get()).data()).toEqual(beforeCast);
    expect((await project.collection("shots").doc("new-upload").get()).data()).toEqual(beforeNewShot);
    expect((beforeNewShot!.analysis as PhotoAnalysis).faces?.[0]?.characterId).toBeUndefined();
  });

  it("writes an empty cast and does not touch shots when there are no faces", async () => {
    const projectId = `ensure-cast-empty-${crypto.randomUUID()}`;
    projects.push(projectId);
    const project = adminDb.collection("projects").doc(projectId);
    await project.set({ id: projectId });
    const { cast } = await ensureCast(adminDb, projectId);
    expect(cast).toEqual({ people: [], core: [], focus: [], source: "none" });
    expect((await project.collection("shots").get()).empty).toBe(true);
    expect((await project.collection("cast").doc("current").get()).exists).toBe(true);
  });
});
