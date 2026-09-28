import { describe, expect, it, vi } from "vitest";
import type { PhotoAnalysis, VideoShotAnalysis } from "../domain/understanding.js";
import { createPlanningTools, type PlanningAsset, type PlanningShot } from "./tools.js";

const photo = (caption: string): PhotoAnalysis => ({
  kind: "photo",
  caption,
  subjects: [],
  setting: "park",
  activities: [],
  mood: "warm",
  shotType: "wide",
  aesthetics: 4,
  keyMomentScore: 4,
  tags: [],
});

const video = (description: string): VideoShotAnalysis => ({
  kind: "video",
  description,
  camera: "handheld",
  role: "B_ROLL",
  subjects: ["family"],
  emotion: "happy",
  quality: 4,
  usable: true,
  reason: "clear",
});

const shot = (id: string, overrides: Partial<PlanningShot> = {}): PlanningShot => ({
  id,
  projectId: "project-a",
  assetId: `asset-${id}`,
  assetStatus: "understood",
  eventId: "event-1",
  day: "2026-05-03",
  localTime: "2026-05-03T09:00:00",
  place: "Park",
  durationSec: null,
  dupOf: null,
  analysis: photo(id),
  embedding: [1, 0],
  sourceStartSec: null,
  sourceEndSec: null,
  ...overrides,
});

function setup(input: {
  shots?: PlanningShot[];
  assets?: PlanningAsset[];
  excludedShotIds?: string[];
} = {}) {
  const shots = input.shots ?? [];
  const assets = input.assets ?? [];
  const embedContent = vi.fn().mockResolvedValue([[1, 0]]);
  const loadShots = vi.fn(async (_projectId: string) => shots);
  const loadAsset = vi.fn(async (_projectId: string, assetId: string) => assets.find((asset) => asset.id === assetId) ?? null);
  return {
    embedContent,
    loadShots,
    loadAsset,
    tools: createPlanningTools({
      projectId: "project-a",
      excludedShotIds: input.excludedShotIds ?? [],
      embedContent,
      loadShots,
      loadAsset,
    }),
  };
}

describe("createPlanningTools", () => {
  it("searches only the project and embeds a retrieval query", async () => {
    const foreign = shot("foreign", { projectId: "project-b", embedding: [1, 0] });
    const local = shot("local", { embedding: [0.8, 0.2] });
    const { tools, embedContent, loadShots } = setup({ shots: [foreign, local] });

    await expect(tools.searchShots({ query: "family at the park" })).resolves.toEqual([
      "local | photo | 2026-05-03 | Park |  | local. park. warm",
    ]);
    expect(loadShots).toHaveBeenCalledWith("project-a");
    expect(embedContent).toHaveBeenCalledWith(expect.objectContaining({
      contents: ["family at the park"],
      taskType: "RETRIEVAL_QUERY",
    }));
  });

  it("filters before ranking and clamps the search limit to 30", async () => {
    const shots = Array.from({ length: 36 }, (_, index) => shot(`s${index}`, {
      embedding: [36 - index, index],
      analysis: index === 0 ? video("excluded") : photo(`shot ${index}`),
    }));
    const { tools } = setup({ shots, excludedShotIds: ["s0"] });

    const result = await tools.searchShots({ query: "park", filters: { kind: "photo" }, limit: 500 });

    expect(result).toHaveLength(30);
    expect(result.join("\n")).not.toContain("s0 |");
    expect(result[0]).toContain("s1 |");
  });

  it("defaults search results to 12", async () => {
    const { tools } = setup({ shots: Array.from({ length: 20 }, (_, index) => shot(`s${index}`)) });
    await expect(tools.searchShots({ query: "park" })).resolves.toHaveLength(12);
  });

  it("refuses a cross-project shot id and names the offending id", async () => {
    const { tools } = setup({ shots: [shot("local"), shot("foreign", { projectId: "project-b" })] });
    await expect(tools.getShotDetails({ shotIds: ["local", "foreign"] })).rejects.toThrow(/foreign.*project-a/i);
  });

  it("validates project scope before clamping detail results to 10", async () => {
    const local = Array.from({ length: 10 }, (_, index) => shot(`local-${index}`));
    const foreign = shot("foreign-eleventh", { projectId: "project-b" });
    const { tools } = setup({ shots: [...local, foreign] });

    await expect(tools.getShotDetails({
      shotIds: [...local.map((item) => item.id), foreign.id],
    })).rejects.toThrow(/foreign-eleventh.*project-a/i);
  });

  it("clamps detail ids to 10 and never returns an excluded shot", async () => {
    const shots = Array.from({ length: 12 }, (_, index) => shot(`s${index}`));
    const { tools } = setup({ shots, excludedShotIds: ["s2"] });

    const result = await tools.getShotDetails({ shotIds: shots.map((item) => item.id) });

    expect(result.map((item) => item.id)).toEqual(["s0", "s1", "s3", "s4", "s5", "s6", "s7", "s8", "s9"]);
    expect(result.every((item) => item.projectId === "project-a")).toBe(true);
  });

  it("returns no transcript for a photo", async () => {
    const asset: PlanningAsset = {
      id: "photo-asset",
      projectId: "project-a",
      kind: "photo",
      transcript: null,
    };
    const { tools } = setup({ assets: [asset] });
    await expect(tools.getTranscript({ assetId: asset.id })).resolves.toEqual([]);
  });

  it("scopes, filters and clamps transcript lines", async () => {
    const transcript = Array.from({ length: 125 }, (_, index) => ({ startSec: index, endSec: index + 0.5, text: `line ${index}` }));
    const asset: PlanningAsset = { id: "video-asset", projectId: "project-a", kind: "video", transcript };
    const shots = [
      shot("excluded", { assetId: asset.id, analysis: video("secret"), sourceStartSec: 0, sourceEndSec: 2 }),
      shot("allowed", { assetId: asset.id, analysis: video("public"), sourceStartSec: 2, sourceEndSec: 200 }),
    ];
    const { tools, loadAsset } = setup({ assets: [asset], shots, excludedShotIds: ["excluded"] });

    const result = await tools.getTranscript({ assetId: asset.id, fromSec: 0, toSec: 200 });

    expect(loadAsset).toHaveBeenCalledWith("project-a", asset.id);
    expect(result).toHaveLength(120);
    expect(result[0]?.text).toBe("line 2");
    expect(result.at(-1)?.text).toBe("line 121");
  });

  it("remembers only the shots it actually returned, so validation can admit them", async () => {
    const shots = [shot("hit", { embedding: [1, 0] }), shot("miss", { embedding: [0, 1] }), shot("detailed", { embedding: [0.5, 0.5] })];
    const { tools } = setup({ shots });

    expect(tools.returnedShots()).toEqual([]);
    await tools.searchShots({ query: "park", limit: 1 });
    await tools.getShotDetails({ shotIds: ["detailed"] });
    await tools.searchShots({ query: "park", limit: 1 });

    expect(tools.returnedShots().map(({ id }) => id)).toEqual(["hit", "detailed"]);
  });
});
