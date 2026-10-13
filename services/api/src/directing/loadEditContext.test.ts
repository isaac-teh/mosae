import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { loadEditContext } from "./loadEditContext.js";

function fixture(overrides: Record<string, unknown> = {}) {
  const records: Record<string, any> = {
    "projects/p": { userId: "owner" }, "projects/p/generations/g": {},
    "projects/p/cast/current": { confirmed: true, focus: ["one"], people: [{ personId: "one", name: "Sam" }, { personId: "two", name: "Sam" }, { personId: "skip", name: "Skip", excluded: true }] },
    "projects/p/assets/a": { generation: 1, status: "understood" },
    "projects/p/shots/photo": { assetId: "a", assetGeneration: 1, analysis: { kind: "photo", caption: "Sam at the lake", setting: "lake", mood: "happy", activities: [], tags: [], keyMomentScore: 1, faces: [{ characterId: "one" }, { characterId: "skip" }] } },
    "projects/p/shots/video": { assetId: "a", assetGeneration: 1, sourceStartSec: 1, sourceEndSec: 5, analysis: { kind: "video", description: "lake", emotion: "calm", subjects: [], quality: 1, usable: true } },
    "projects/p/shots/bad": { assetId: "a", assetGeneration: 1, analysis: { kind: "video", usable: true } },
    "projects/p/shots/foreign": { projectId: "other", assetId: "a", assetGeneration: 1, analysis: { kind: "photo" } },
    ...overrides,
  };
  const snap = (path: string) => ({ exists: records[path] !== undefined, id: path.split("/").at(-1), data: () => records[path], get: (key: string) => records[path]?.[key] });
  const ref = (path: string): any => ({ get: async () => snap(path), path, collection: (name: string) => collection(`${path}/${name}`) });
  const collection = (path: string): any => ({ doc: (id: string) => ref(`${path}/${id}`), limit: () => collection(path), get: async () => ({ docs: Object.keys(records).filter(key => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1).map(snap) }) });
  return { doc: ref, collection, getAll: async (...refs: any[]) => refs.map(ref => snap(ref.path)) } as unknown as Firestore;
}

describe("owned edit context", () => {
  it("uses confirmed person IDs, excludes skipped people and preserves ambiguous duplicate names", async () => {
    const result = await loadEditContext(fixture(), "owner", "p", "g", { kind: "film" });
    expect(result.people.map(p => p.personId)).toEqual(["one", "two"]);
    expect(result.people.map(p => p.name)).toEqual(["Sam", "Sam"]);
    expect(result.candidates.find(c => c.shotId === "photo")?.personIds).toEqual(["one"]);
  });
  it("excludes foreign sources and videos with missing/unusable bounds", async () => {
    const result = await loadEditContext(fixture(), "owner", "p", "g", { kind: "film" });
    expect(result.candidates.map(c => c.shotId).sort()).toEqual(["photo", "video"]);
    expect(result.candidates.find(c => c.shotId === "video")).toMatchObject({ sourceStartSec: 1, sourceEndSec: 5 });
  });
  it("caps a ranked catalogue at 40 without adding inferred people", async () => {
    const records = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`projects/p/shots/p${index}`, { assetId: "a", assetGeneration: 1, analysis: { kind: "photo", caption: "memory", setting: "", mood: "", activities: [], tags: [], keyMomentScore: index } }]));
    const context = await loadEditContext(fixture({ ...records, "projects/p/cast/current": { confirmed: false, people: [{ personId: "guess", name: "Sam" }] } }), "owner", "p", "g", { kind: "film" });
    expect(context.candidates).toHaveLength(40);
    expect(context.people).toEqual([]);
    expect(context.candidates[0].shotId).toBe("p69");
  });
  it("loads generation-pinned story and constraints", async () => {
    const context = await loadEditContext(fixture({ "projects/p/generations/g": { proposalId: "proposal", settings: { focus: "two" } }, "projects/p/storyProposals/proposal": { storyIntentId: "intent", constraints: { excludedShotIds: ["photo"] } }, "projects/p/storyIntents/intent": { projectId: "p", text: "Our lake trip", focus: ["family"] } }), "owner", "p", "g", { kind: "film" });
    expect(context.storyIntent).toEqual({ text: "Our lake trip", focus: ["family"] });
    expect(context.people.find(person => person.personId === "two")?.focused).toBe(true);
    expect(context.candidates.map(candidate => candidate.shotId)).toEqual(["video"]);
  });
  it("marks every selected person focused for a multi-person direction", async () => {
    const context = await loadEditContext(fixture({ "projects/p/generations/g": { proposalId: "proposal", settings: { focus: "one,two" } } }), "owner", "p", "g", { kind: "film" });
    expect(context.people.filter(person => person.focused).map(person => person.personId)).toEqual(["one", "two"]);
  });
  it("checks ownership before catalog reads", async () => {
    await expect(loadEditContext(fixture(), "stranger", "p", "g", { kind: "film" })).rejects.toThrow("not_found");
  });
  it("degrades safely without story or confirmed cast and loads catalogue music", async () => {
    const result = await loadEditContext(fixture({ "projects/p/cast/current": undefined }), "owner", "p", "g", { kind: "film" });
    expect(result.people).toEqual([]);
    expect(result.storyIntent).toBeNull();
    expect(result.soundtracks.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(40);
  });
});
