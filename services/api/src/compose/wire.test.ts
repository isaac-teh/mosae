import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { StoryProposal } from "@mosae/contracts";

vi.mock("../store/enqueueRender.js", () => ({ enqueueRender: vi.fn() }));
vi.mock("../store/generationStore.js", () => ({ publishGeneration: vi.fn(), failGeneration: vi.fn() }));
vi.mock("./runCompose.js", () => ({ runCompose: vi.fn() }));

import { enqueueRender } from "../store/enqueueRender.js";
import { publishGeneration } from "../store/generationStore.js";
import { runCompose } from "./runCompose.js";
import { createCompose, loadComposeCatalog } from "./wire.js";

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

function composeFirestore(proposalData: StoryProposal, focus?: string, excluded = false, duration: { durationId: string | null; durationSec?: number } = { durationId: "30s" }): Firestore {
  const generationData = {
    schemaVersion: 1,
    proposalId: proposalData.id,
    status: "composing",
    seed: "seed-1",
    settings: { schemaVersion: 1, id: "settings-1", projectId: "project1", version: 1, note: "", cadenceId: "tender", soundtrackId: null, durationId: duration.durationId, ...(duration.durationSec === undefined ? {} : { durationSec: duration.durationSec }), aspect: "9:16", captions: false, ...(focus === undefined ? {} : { focus }) },
  };
  const generationSnap = { exists: true, data: () => generationData };
  const proposalSnap = { exists: true, data: () => proposalData };
  const projectSnap = { exists: true, get: (key: string) => ({ userId: "owner", mode: "memory" } as Record<string, unknown>)[key] };
  const emptyCollection = { get: async () => ({ docs: [] }) };
  const projectRef = {
    get: async () => projectSnap,
    collection: (name: string) => {
      if (name === "generations") return { doc: () => ({ get: async () => generationSnap }) };
      if (name === "storyProposals") return { doc: () => ({ get: async () => proposalSnap }) };
      if (name === "storyIntents") return { doc: () => ({ get: async () => ({ exists: true, get: () => "Family beach trip" }) }) };
      if (name === "cast") return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ confirmed: true, source: "none", core: [], focus: ["old-focus"], people: [{ personId: "person-1", name: "Mum", role: "parent", ageBand: "adult", appearances: 1, faceIds: [], confidence: "high", excluded }, { personId: "child", name: "Mia", role: "child", ageBand: "child", appearances: 1, faceIds: [], confidence: "high" }] }) }) }) };
      return emptyCollection;
    },
  };
  return { collection: (name: string) => name === "users"
    ? { doc: () => ({ get: async () => ({ exists: true, get: () => [] }) }) }
    : { doc: () => projectRef } } as unknown as Firestore;
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

describe("createCompose render handoff", () => {
  it("publishes a playable generation without starting a render", async () => {
    const projectId = "project1";
    const generationId = "generation1";
    const proposalData = proposal();
    const db = composeFirestore(proposalData);
    vi.mocked(enqueueRender).mockClear();
    vi.mocked(publishGeneration).mockResolvedValue({} as never);
    vi.mocked(runCompose).mockResolvedValue({ ok: true, timeline: {} as never, droppedPicks: [], reasons: [] } as never);

    const compose = createCompose({
      db,
      generateStructured: async () => ({}) as never,
    });

    await expect(compose({ projectId, generationId })).resolves.toBe("composed");

    expect(publishGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "owner", projectId, generationId }));
    expect(enqueueRender).not.toHaveBeenCalled();
  });

  it("marks a tierless film below 20 seconds with the existing Short tier", async () => {
    const projectId = "project1";
    const generationId = "generation1";
    const db = composeFirestore(proposal(), undefined, false, { durationId: null });
    vi.mocked(publishGeneration).mockResolvedValue({} as never);
    vi.mocked(runCompose).mockResolvedValue({
      ok: true, timeline: { durationSec: 12 } as never, droppedPicks: [], reasons: [],
      durationSelection: { id: "short", durationSec: 12 },
    } as never);
    const compose = createCompose({ db, generateStructured: async () => ({}) as never });

    await expect(compose({ projectId, generationId })).resolves.toBe("composed");
    expect(publishGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      settings: expect.objectContaining({ durationId: "short", durationSec: 12 }),
    }));
  });
});

describe("generation focus", () => {
  it.each([["person-1", ["person-1"], "Mum"], ["family", [], "everyone"], [undefined, ["old-focus"], "children"]])("applies %s to composition constraints", async (focus, expected, expectedSummary) => {
    vi.mocked(runCompose).mockClear();
    vi.mocked(runCompose).mockResolvedValue({ ok: true, timeline: {} as never, droppedPicks: [], reasons: [] } as never);
    const compose = createCompose({ db: composeFirestore(proposal({ focusCharacterIds: ["old-focus"] }), focus), generateStructured: async () => ({}) as never });
    await expect(compose({ projectId: "project1", generationId: "generation1" })).resolves.toBe("composed");
    expect(runCompose).toHaveBeenCalledWith(expect.objectContaining({ cast: expect.objectContaining({ focus: expected, summary: expect.stringContaining(`focus: ${expectedSummary};`) }), proposal: expect.objectContaining({ constraints: expect.objectContaining({ focusCharacterIds: expected }) }) }), expect.anything());
  });
});

it("passes the adaptive short target from stored settings to compose", async () => {
  vi.mocked(runCompose).mockClear();
  vi.mocked(runCompose).mockResolvedValue({ ok: true, timeline: {} as never, droppedPicks: [], reasons: [] } as never);
  const compose = createCompose({ db: composeFirestore(proposal(), undefined, false, { durationId: "short", durationSec: 15 }), generateStructured: async () => ({}) as never });
  await expect(compose({ projectId: "project1", generationId: "generation1" })).resolves.toBe("composed");
  expect(runCompose).toHaveBeenCalledWith(expect.objectContaining({ durationId: "short", durationSec: 15 }), expect.anything());
});

it.each([["unknown", false], ["person-1", true]])("refuses invalid composition focus %s", async (focus, excluded) => {
  vi.mocked(runCompose).mockClear();
  const compose = createCompose({ db: composeFirestore(proposal(), focus, excluded), generateStructured: async () => ({}) as never });
  await expect(compose({ projectId: "project1", generationId: "generation1" })).resolves.toBe("failed");
  expect(runCompose).not.toHaveBeenCalled();
});
