import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Generation } from "@mosae/contracts";
import { publishGeneration } from "../store/generationStore.js";

function assertNoUndefined(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoUndefined(item);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      if (item === undefined) throw new Error("Firestore value cannot be undefined");
      assertNoUndefined(item);
    }
  }
}

describe("publishGeneration", () => {
  it("strips undefined nested optional values before the Firestore transaction write", async () => {
    const projectId = "project-1";
    const generationId = "generation-1";
    const timeline = {
      schemaVersion: 2 as const,
      projectId,
      mode: "memory" as const,
      aspect: "9:16" as const,
      fps: 30 as const,
      durationSec: 6,
      chapters: [{ title: "Day 1 · Siloso Beach", startSec: 0 }],
      videoClips: [{
        kind: "collage" as const,
        clipId: "collage-1",
        chapterId: "chapter-1",
        startSec: 0,
        durationSec: 6,
        transitionIn: { kind: "cut" as const, durationSec: 0 },
        spec: {
          layoutId: "torn-paper" as const,
          motionId: "print-drop" as const,
          effectId: null,
          seed: "seed",
          durationSec: 6,
          slots: ["one", "two", "three"].map((slotId) => ({ slotId, shotId: `shot-${slotId}`, kind: "photo" as const })),
          caption: { place: "Day 1 · Siloso Beach", date: undefined },
        },
      }],
      audioClips: [],
      captions: [],
    } as unknown as Generation["timeline"];
    const generation: Generation = {
      schemaVersion: 1,
      id: generationId,
      projectId,
      proposalId: "proposal-1",
      parentGenerationId: null,
      settings: { schemaVersion: 1, id: "settings-1", projectId, version: 1, note: "", cadenceId: "tender", soundtrackId: null, durationId: "30s", aspect: "9:16", captions: false, collageAmount: "few", motionFeel: "calm" },
      seed: "seed",
      status: "composing",
      timeline: null,
      droppedPicks: [],
      failureReasons: [],
      outputPath: null,
      renderProgress: 0,
    };
    const genRef = { path: `projects/${projectId}/generations/${generationId}` };
    const projectRef = {
      path: `projects/${projectId}`,
      collection: vi.fn(() => ({ doc: vi.fn(() => genRef) })),
    };
    const projectSnap = { exists: true, get: (field: string) => field === "userId" ? "owner" : generationId };
    const genSnap = { exists: true, data: () => generation };
    const tx = {
      get: vi.fn(async (ref: unknown) => ref === projectRef ? projectSnap : genSnap),
      set: vi.fn((_ref: unknown, value: unknown) => assertNoUndefined(value)),
      update: vi.fn(),
    };
    const db = {
      collection: vi.fn(() => ({ doc: vi.fn(() => projectRef) })),
      runTransaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    } as unknown as Firestore;

    await expect(publishGeneration(db, {
      userId: "owner", projectId, generationId, timeline, droppedPicks: [], now: 1,
    })).resolves.toMatchObject({ status: "playable" });
    expect(tx.set).toHaveBeenCalledOnce();
    expect(tx.set.mock.calls[0][1]).toMatchObject({ timeline: { videoClips: [{ spec: { caption: { place: "Day 1 · Siloso Beach" } } }] } });
    expect(JSON.stringify(tx.set.mock.calls[0][1])).not.toContain("date");
  });
});
