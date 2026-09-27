import { describe, expect, it } from "vitest";
import { adminDb } from "../firebase/admin.js";
import type { PhotoAnalysis } from "../domain/understanding.js";
import { assignFaceCharacter, getProjectFaces } from "./understandStore.js";

const id = () => crypto.randomUUID();

function photoShot(shotId: string, faces: PhotoAnalysis["faces"]): PhotoAnalysis {
  return { kind: "photo", caption: "", subjects: [], setting: "", activities: [], mood: "", shotType: "", aesthetics: 0, keyMomentScore: 0, tags: [], faces };
}

async function seedProject(userId = id()) {
  const projectId = id();
  await adminDb.doc(`projects/${projectId}`).set({ id: projectId, userId, status: "understood", createdAt: 1 });
  return { projectId, userId };
}

function photo(projectId: string, shotId: string, faces: PhotoAnalysis["faces"]) {
  return adminDb.doc(`projects/${projectId}/shots/${shotId}`).set({ id: shotId, assetId: shotId, index: 0, analysis: photoShot(shotId, faces) });
}

const face = (faceId: string): NonNullable<PhotoAnalysis["faces"]>[number] => ({ faceId, bbox: [0.1, 0.2, 0.3, 0.4], confidence: 1 });

describe("character store (emulator)", () => {
  it("reads every photo-face grouped by shot", async () => {
    const { projectId } = await seedProject();
    await photo(projectId, "shot-1", [face("shot-1-f0"), face("shot-1-f1")]);
    await photo(projectId, "shot-2", [face("shot-2-f0")]);

    const shots = await getProjectFaces(adminDb, projectId);
    expect(shots.map((s) => s.shotId)).toEqual(["shot-1", "shot-2"]);
    expect(shots.find((s) => s.shotId === "shot-1")?.analysis?.faces).toHaveLength(2);
    expect(shots.find((s) => s.shotId === "shot-2")?.analysis?.faces).toHaveLength(1);
  });

  it("assigns a characterId derived from the name", async () => {
    const { projectId, userId } = await seedProject();
    await photo(projectId, "shot-1", [face("shot-1-f0")]);

    const assigned = await assignFaceCharacter(adminDb, { userId, projectId, shotId: "shot-1", assignment: { faceId: "shot-1-f0", name: "Alice" } });
    expect(assigned.name).toBe("Alice");
    expect(assigned.characterId).toBe(`char-${projectId}-alice`);

    const stored = (await adminDb.doc(`projects/${projectId}/shots/shot-1`).get()).data();
    expect(stored?.analysis.faces[0].characterId).toBe(`char-${projectId}-alice`);
  });

  it("merges two crops named the same into one character", async () => {
    const { projectId, userId } = await seedProject();
    await photo(projectId, "shot-1", [face("shot-1-f0"), face("shot-1-f1")]);
    await photo(projectId, "shot-2", [face("shot-2-f0")]);

    await assignFaceCharacter(adminDb, { userId, projectId, shotId: "shot-1", assignment: { faceId: "shot-1-f0", name: "daughter" } });
    await assignFaceCharacter(adminDb, { userId, projectId, shotId: "shot-2", assignment: { faceId: "shot-2-f0", name: "Daughter" } });

    const faces = await getProjectFaces(adminDb, projectId);
    const ids = new Set(faces.flatMap((s) => s.analysis?.faces ?? []).map((f) => f.characterId).filter(Boolean));
    expect(ids.size).toBe(1);
  });

  it("rejects an assignment to a shot in someone else's project", async () => {
    const { projectId } = await seedProject();
    await photo(projectId, "shot-1", [face("shot-1-f0")]);
    await expect(assignFaceCharacter(adminDb, { userId: "intruder", projectId, shotId: "shot-1", assignment: { faceId: "shot-1-f0", name: "Bob" } })).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects an assignment to a missing shot", async () => {
    const { projectId, userId } = await seedProject();
    await expect(assignFaceCharacter(adminDb, { userId, projectId, shotId: "nope", assignment: { faceId: "x", name: "Bob" } })).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects an assignment to a missing face", async () => {
    const { projectId, userId } = await seedProject();
    await photo(projectId, "shot-1", [face("shot-1-f0")]);
    await expect(assignFaceCharacter(adminDb, { userId, projectId, shotId: "shot-1", assignment: { faceId: "missing", name: "Bob" } })).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects an invalid role without writing", async () => {
    const { projectId, userId } = await seedProject();
    await photo(projectId, "shot-1", [face("shot-1-f0")]);
    await expect(assignFaceCharacter(adminDb, { userId, projectId, shotId: "shot-1", assignment: { faceId: "shot-1-f0", name: "Bob", role: "LEAD" } as unknown as import("./understandStore.js").FaceAssignment })).rejects.toMatchObject({ code: "invalid_assignment" });
    const stored = (await adminDb.doc(`projects/${projectId}/shots/shot-1`).get()).data();
    expect(stored?.analysis.faces[0].characterId).toBeUndefined();
  });

  it("overwrites a previous assignment", async () => {
    const { projectId, userId } = await seedProject();
    await photo(projectId, "shot-1", [face("shot-1-f0")]);
    await assignFaceCharacter(adminDb, { userId, projectId, shotId: "shot-1", assignment: { faceId: "shot-1-f0", name: "Bob" } });
    const reassigned = await assignFaceCharacter(adminDb, { userId, projectId, shotId: "shot-1", assignment: { faceId: "shot-1-f0", name: "Alice" } });
    expect(reassigned.name).toBe("Alice");
    expect(reassigned.characterId).toBe(`char-${projectId}-alice`);
  });

  it("does not assign identity to a video shot", async () => {
    const { projectId, userId } = await seedProject();
    await adminDb.doc(`projects/${projectId}/shots/shot-v`).set({ id: "shot-v", assetId: "shot-v", index: 0, analysis: { kind: "video" } });
    await expect(assignFaceCharacter(adminDb, { userId, projectId, shotId: "shot-v", assignment: { faceId: "x", name: "Bob" } })).rejects.toMatchObject({ code: "invalid_face" });
  });
});
