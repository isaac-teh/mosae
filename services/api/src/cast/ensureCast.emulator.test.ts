import { afterEach, describe, expect, it } from "vitest";
import { getStorage } from "firebase-admin/storage";
import { adminDb, getAdminApp } from "../firebase/admin.js";
import type { PhotoAnalysis } from "../domain/understanding.js";
import { sha256Hex } from "./photoHash.js";
import { ensureCast } from "./ensureCast.js";
import type { LabelFile } from "./labelledIdentity.js";

const bucket = getStorage(getAdminApp()).bucket(process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com");
const projects: string[] = [];
const paths: string[] = [];
afterEach(async () => {
  await Promise.all(projects.splice(0).map((id) => adminDb.recursiveDelete(adminDb.doc(`projects/${id}`))));
  await Promise.all(paths.splice(0).map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
});

describe("ensureCast emulator", () => {
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
