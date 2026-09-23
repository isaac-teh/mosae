import { describe, expect, it } from "vitest";
import { buildWorkingSet, compactShotLine, type WorkingShot } from "./workingSet.js";

const photoAnalysis = (score: number) => ({
  kind: "photo" as const,
  caption: `photo ${score}`,
  subjects: [], setting: "park", activities: [], mood: "warm", shotType: "wide",
  aesthetics: 4, keyMomentScore: score, tags: [],
});

const videoAnalysis = (quality: number, usable = true) => ({
  kind: "video" as const,
  description: `video ${quality}`,
  camera: "handheld", role: "B_ROLL" as const, subjects: [], emotion: "happy",
  quality, usable, reason: "clear",
});

const shot = (id: string, eventId: string, analysis: WorkingShot["analysis"], overrides: Partial<WorkingShot> = {}): WorkingShot => ({
  id, assetStatus: "understood", eventId, day: "2026-05-03", place: "Park",
  durationSec: analysis?.kind === "video" ? 3 : null, analysis, ...overrides,
});

describe("buildWorkingSet", () => {
  it("filters in the specified eligibility order", () => {
    const input = [
      shot("not-understood", "e1", photoAnalysis(5), { assetStatus: "ingested" }),
      shot("no-analysis", "e1", null),
      shot("unusable", "e1", videoAnalysis(5, false)),
      shot("duplicate", "e1", photoAnalysis(5), { dupOf: "primary" }),
      shot("excluded", "e1", photoAnalysis(5)),
      shot("kept", "e1", photoAnalysis(1)),
    ];
    expect(buildWorkingSet(input, { excludedShotIds: ["excluded"] }).shots.map((item) => item.id)).toEqual(["kept"]);
  });

  it("spreads a small cap round-robin across events after ranking each event", () => {
    const input = [
      shot("e1-best", "e1", photoAnalysis(5)), shot("e1-next", "e1", photoAnalysis(4)), shot("e1-last", "e1", photoAnalysis(3)),
      shot("e2-only", "e2", photoAnalysis(1)),
    ];
    expect(buildWorkingSet(input, { cap: 2 }).shots.map((item) => item.id)).toEqual(["e1-best", "e2-only"]);
  });

  it("keeps event spread stable when shots arrive in a different order", () => {
    const input = [
      shot("later-best", "e2", photoAnalysis(5), { day: "2026-05-04" }),
      shot("earlier-best", "e1", photoAnalysis(1), { day: "2026-05-03" }),
    ];
    const permuted = [...input].reverse();
    expect(buildWorkingSet(input, { cap: 1 }).shots.map((item) => item.id)).toEqual(["earlier-best"]);
    expect(buildWorkingSet(permuted, { cap: 1 }).shots.map((item) => item.id)).toEqual(["earlier-best"]);
  });

  it("uses the default cap of exactly 180 eligible shots", () => {
    const input = Array.from({ length: 181 }, (_, index) => shot(`s${index}`, "e1", photoAnalysis(1)));
    expect(buildWorkingSet(input).shots).toHaveLength(180);
  });

  it("forces a must-include shot below the cap", () => {
    const input = Array.from({ length: 3 }, (_, index) => shot(`s${index}`, "e1", photoAnalysis(5 - index)));
    expect(buildWorkingSet(input, { cap: 1, mustIncludeMomentIds: ["s2"] }).shots.map((item) => item.id)).toEqual(["s0", "s2"]);
  });

  it("keeps a must-include shot that eligibility ranking would drop", () => {
    const input = [
      shot("ranked", "e1", photoAnalysis(5)),
      shot("duplicate", "e1", photoAnalysis(4), { dupOf: "ranked" }),
      shot("unusable", "e1", videoAnalysis(4, false)),
      shot("not-understood", "e1", photoAnalysis(4), { assetStatus: "ingested" }),
    ];

    const built = buildWorkingSet(input, { mustIncludeShotIds: ["duplicate", "unusable", "not-understood"] });

    expect(built.shots.map((item) => item.id)).toEqual(["ranked", "duplicate", "unusable", "not-understood"]);
    expect(built.lines).toHaveLength(4);
  });

  it("rejects a shot that is required and excluded at once", () => {
    const input = [shot("kept", "e1", photoAnalysis(5)), shot("both", "e1", photoAnalysis(4))];

    expect(() => buildWorkingSet(input, { excludedShotIds: ["both"], mustIncludeShotIds: ["both"] }))
      .toThrow(/keep both.*leave the same moment out/i);
  });

  it("rejects a must-include shot that has no analysis to describe", () => {
    const input = [shot("kept", "e1", photoAnalysis(5)), shot("raw", "e1", null, { assetStatus: "ingested" })];

    expect(() => buildWorkingSet(input, { mustIncludeMomentIds: ["raw"] }))
      .toThrow(/raw is still being processed/i);
  });

  it("supports all-photo projects and an empty eligible set", () => {
    expect(buildWorkingSet([shot("photo", "e1", photoAnalysis(3))]).shots[0].id).toBe("photo");
    expect(buildWorkingSet([shot("bad", "e1", null)]).shots).toEqual([]);
  });
});

describe("compactShotLine", () => {
  it("emits the catalog fields and phase 2 analysis text", () => {
    const item = shot("s1", "e1", photoAnalysis(3), { day: "2026-05-03", place: "Park", durationSec: null });
    expect(compactShotLine(item)).toBe("s1 | photo | 2026-05-03 | Park |  | photo 3. park. warm");
  });
});
