import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { StoryProposal } from "@mosae/contracts";
import { loadComposeCatalog } from "./wire.js";

function proposal(constraints: Partial<StoryProposal["constraints"]> = {}): StoryProposal {
  return {
    schemaVersion: 1,
    id: "p1",
    projectId: "project1",
    storyIntentId: "intent1",
    parentProposalId: null,
    state: "accepted",
    version: 1,
    title: "A trip",
    moments: [
      { id: "m1", shotId: "s1", kind: "photo", title: "One", description: "", rationale: "" },
      { id: "m2", shotId: "s2", kind: "photo", title: "Two", description: "", rationale: "" },
    ],
    chapters: [{ id: "c1", title: "Day", summary: "", momentIds: ["m1", "m2"] }],
    constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [], ...constraints },
    openQuestions: [],
  };
}

function firestore() {
  const shotRows = [
    { id: "s1", data: { assetId: "a1", assetGeneration: "1", analysis: { kind: "photo", caption: "original" } } },
    { id: "s2", data: { assetId: "a2", assetGeneration: "1", analysis: { kind: "photo", caption: "second" } } },
    { id: "s9", data: { assetId: "a9", assetGeneration: "1", analysis: { kind: "photo", caption: "swap" } } },
  ];
  const assets = [
    { id: "a1", data: { generation: "1", fileName: "one.jpg", eventId: "burst", dupOf: "a0", media: { localTime: "2026-05-03T09:00:00" }, quality: { dHash: "0000000000000001" } } },
    { id: "a2", data: { generation: "1", fileName: "two.jpg" } },
    { id: "a9", data: { generation: "1", fileName: "replacement.jpg" } },
  ];
  const db = {
    collection: () => ({ doc: () => ({ collection: (name: string) => ({
      get: async () => ({ docs: (name === "shots" ? shotRows : assets).map((row) => ({
        id: row.id,
        data: () => row.data,
        get: (key: string) => (row.data as Record<string, unknown>)[key],
      })) }),
    }) }) }),
  };
  return db as unknown as Firestore;
}

describe("loadComposeCatalog review edits", () => {
  it("uses swap shots, hides original shots, and ignores swaps pointing at hidden shots", async () => {
    const catalog = await loadComposeCatalog(firestore(), "project1", proposal({
      photoSwaps: { m1: "s9", m2: "s9" },
      hiddenShotIds: ["s9", "s2"],
    }));
    expect(catalog.has("m1")).toBe(true); // hidden alternative falls back to the visible original.
    expect(catalog.has("m2")).toBe(false); // hidden original is not offered.
  });

  it("uses the selected alternative's asset for a visible swap", async () => {
    const catalog = await loadComposeCatalog(firestore(), "project1", proposal({ photoSwaps: { m1: "s9" } }));
    expect(catalog.get("m1")).toEqual({ kind: "photo", file: "replacement.jpg", assetId: "a9", eventId: null, localTime: null, dHash: null, dupOf: null, analysis: { caption: "swap", keyMomentScore: undefined } });
  });

  it("carries event, duplicate, capture-time, and hash metadata into the collage catalog", async () => {
    const catalog = await loadComposeCatalog(firestore(), "project1", proposal());
    expect(catalog.get("m1")).toMatchObject({
      assetId: "a1", eventId: "burst", dupOf: "a0",
      localTime: "2026-05-03T09:00:00", dHash: "0000000000000001",
    });
  });
});
