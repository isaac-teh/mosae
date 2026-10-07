import { describe, expect, it } from "vitest";
import { parseTimeline } from "@mosae/contracts";
import { adminDb } from "../firebase/admin.js";
import { saveEditDocument } from "../directing/editStore.js";
import { joinReadyVideo } from "./lateVideoStore.js";

const timeline = (projectId: string) => parseTimeline({
  schemaVersion: 1, projectId, mode: "memory", aspect: "9:16", fps: 30, durationSec: 3,
  chapters: [{ title: "Day", startSec: 0 }],
  videoClips: [{ id: "photo-clip", source: { kind: "photo", shotId: "photo-shot" }, startSec: 0, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } }],
  audioClips: [], captions: [],
});

async function seed(status: "playable" | "saved" = "playable", revision = 0) {
  const projectId = crypto.randomUUID();
  const project = adminDb.doc(`projects/${projectId}`);
  await project.set({ id: projectId, userId: "owner", currentPlayableGenerationId: "g1" });
  await project.collection("generations").doc("g1").set({ status, composedEditRevision: 0, timeline: timeline(projectId), lateVideoEvents: [] });
  await project.collection("assets").doc("photo").set({ id: "photo", media: { kind: "photo", localTime: "2026-10-01T09:00:00Z" } });
  await project.collection("shots").doc("photo-shot").set({ id: "photo-shot", assetId: "photo", index: 0 });
  await project.collection("assets").doc("late-video").set({ id: "late-video", status: "understood", fileName: "beach.mov", place: { name: "Beach" }, media: { kind: "video", durationSec: 8, localTime: "2026-10-01T10:00:00Z" } });
  await project.collection("shots").doc("late-shot").set({ id: "late-shot", assetId: "late-video", index: 0, sourceStartSec: 0, sourceEndSec: 8, signals: { stepSec: 0.25, shake: [], blur: [], loud: [] }, analysis: { kind: "video", highlights: [{ startSec: 5, endSec: 7, label: "Splash", score: 1 }] } });
  if (revision > 0) await project.collection("generations").doc("g1").collection("edits").doc("current").set({ revision, ops: [{ op: "setPhotoDuration", clipId: "photo-clip", sec: 4 }], updatedAt: 1 });
  return { projectId, generation: project.collection("generations").doc("g1") };
}

describe("late video readiness transition (emulator)", () => {
  it("adds a scored window as a revision, can undo it, and remains idempotent", async () => {
    const { projectId, generation } = await seed();
    await expect(joinReadyVideo(adminDb, projectId, "late-video")).resolves.toBe("added");
    const first = await generation.collection("edits").doc("current").get();
    expect(first.data()).toMatchObject({ revision: 1, ops: [{ op: "add", shotId: "late-shot", sourceInSec: expect.any(Number) }] });
    expect((first.get("ops") as { sourceInSec: number }[])[0]!.sourceInSec).toBeGreaterThan(3);
    expect((await generation.get()).get("lateVideoEvents")).toMatchObject([{ label: "Beach", status: "added", previousOps: [] }]);
    await expect(joinReadyVideo(adminDb, projectId, "late-video")).resolves.toBe("skipped");
    await expect(saveEditDocument(adminDb, "owner", projectId, "g1", { revision: 2, ops: [] })).resolves.toMatchObject({ status: "saved" });
    expect((await generation.collection("edits").doc("current").get()).data()).toMatchObject({ revision: 2, ops: [] });
  });

  it("offers a saved generation without changing its edit revision", async () => {
    const { projectId, generation } = await seed("saved");
    await expect(joinReadyVideo(adminDb, projectId, "late-video")).resolves.toBe("offered");
    expect((await generation.get()).get("lateVideoEvents")).toMatchObject([{ status: "offered", label: "Beach" }]);
    expect((await generation.collection("edits").doc("current").get()).exists).toBe(false);
  });

  it("offers when the edit revision changed after the cut", async () => {
    const { projectId, generation } = await seed("playable", 1);
    await expect(joinReadyVideo(adminDb, projectId, "late-video")).resolves.toBe("offered");
    expect((await generation.collection("edits").doc("current").get()).get("revision")).toBe(1);
    expect((await generation.get()).get("lateVideoEvents")).toMatchObject([{ status: "offered" }]);
  });
});
