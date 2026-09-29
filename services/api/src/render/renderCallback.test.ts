import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Generation } from "@mosae/contracts";
import { applyRenderCallback, type RenderCallbackEvent } from "./renderCallback.js";
import { FakeFirestore } from "./fakeFirestore.js";

function seed() {
  const db = new FakeFirestore();
  db.docs.set("projects/p1", { id: "p1", userId: "owner" });
  db.docs.set("projects/p1/generations/g1", {
    id: "g1", projectId: "p1", status: "rendering", renderProgress: 0.25,
    timeline: {}, outputPath: null, failureReasons: [],
  });
  return db;
}

const generation = (db: FakeFirestore) => db.docs.get("projects/p1/generations/g1") as unknown as Generation;

describe("applyRenderCallback", () => {
  it("persists progress from the separate render worker", async () => {
    const db = seed();
    await applyRenderCallback(db as unknown as Firestore, { kind: "progress", projectId: "p1", generationId: "g1", progress: 0.6 });
    expect(generation(db)).toMatchObject({ status: "rendering", renderProgress: 0.6 });
  });

  it("settles completion idempotently when Cloud Tasks retries the callback", async () => {
    const db = seed();
    const event: RenderCallbackEvent = { kind: "complete", projectId: "p1", generationId: "g1", outputPath: "renders/owner/p1/g1.mp4" };
    await applyRenderCallback(db as unknown as Firestore, event);
    await expect(applyRenderCallback(db as unknown as Firestore, event)).resolves.toBe("already_settled");
    expect(generation(db)).toMatchObject({ status: "saved", renderProgress: 1, outputPath: event.outputPath });
  });

  it("returns a failed render to playable so the user can retry", async () => {
    const db = seed();
    await applyRenderCallback(db as unknown as Firestore, { kind: "failed", projectId: "p1", generationId: "g1", reason: "decode failed" });
    expect(generation(db)).toMatchObject({ status: "playable", renderProgress: 0, failureReasons: ["decode failed"] });
  });

  it("settles edit callbacks on the matching revision without changing the generation", async () => {
    const db = seed();
    db.docs.set("projects/p1/generations/g1/edits/current", { renderRevision: 4, status: "rendering" });
    db.docs.set("projects/p1/generations/g1/edits/current/revisions/4", { status: "rendering" });
    await applyRenderCallback(db as unknown as Firestore, {
      kind: "complete", projectId: "p1", generationId: "g1", revision: 4, outputPath: "renders/owner/p1/g1-edit-4.mp4",
    });
    expect(db.docs.get("projects/p1/generations/g1/edits/current")).toMatchObject({ status: "ready", outputPath: "renders/owner/p1/g1-edit-4.mp4" });
    expect(db.docs.get("projects/p1/generations/g1/edits/current/revisions/4")).toMatchObject({ status: "ready", outputPath: "renders/owner/p1/g1-edit-4.mp4" });
    expect(generation(db).status).toBe("rendering");
  });
});
