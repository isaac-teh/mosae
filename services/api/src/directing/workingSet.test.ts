import { describe, expect, it } from "vitest";
import { buildWorkingSet, compactShotLine, resolveFocusShots, type WorkingShot } from "./workingSet.js";
import type { Face } from "../domain/understanding.js";

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

const face = (characterId: string, confidence = 0.9): Face => ({
  faceId: `${characterId}-face`, bbox: [0.2, 0.3, 0.5, 0.6], confidence, characterId, name: characterId, role: "MAIN",
});

const photoWithFaces = (score: number, faces: Face[]) => ({
  kind: "photo" as const, caption: `photo ${score}`, subjects: [], setting: "park", activities: [], mood: "warm", shotType: "wide", aesthetics: 4, keyMomentScore: score, tags: [], faces,
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

describe("resolveFocusShots", () => {
  it("resolves a shot whose analysis carries a face with a matching characterId", () => {
    const shots = [
      shot("focus-shot", "e1", photoWithFaces(5, [face("char-grandpa")])),
      shot("other-shot", "e1", photoAnalysis(4)),
    ];
    expect(resolveFocusShots(shots, ["char-grandpa"])).toEqual(["focus-shot"]);
  });

  it("ignores shots whose faces have no characterId or a non-matching one", () => {
    const shots = [
      shot("unassigned", "e1", photoWithFaces(5, [{ faceId: "f", bbox: [0, 0, 1, 1], confidence: 0.9 }])),
      shot("wrong-char", "e1", photoWithFaces(4, [face("char-grandpa"), face("char-uncle")])),
    ];
    expect(resolveFocusShots(shots, ["char-grandpa"])).toEqual(["wrong-char"]);
  });

  it("never resolves video shots, which carry no faces", () => {
    const shots = [shot("vid", "e1", videoAnalysis(5))];
    expect(resolveFocusShots(shots, ["char-grandpa"])).toEqual([]);
  });

  it("returns nothing for an empty focus list or a matching id that names no face", () => {
    const shots = [shot("s", "e1", photoWithFaces(5, [face("char-grandpa")]))];
    expect(resolveFocusShots(shots, [])).toEqual([]);
    expect(resolveFocusShots(shots, ["char-nobody"])).toEqual([]);
  });
});

describe("buildWorkingSet — focus join", () => {
  it("folds a focus character's shot into mustInclude so it outranks ranking", () => {
    const shots = [
      shot("best", "e1", photoAnalysis(5)),
      shot("focus-shot", "e1", photoWithFaces(2, [face("char-grandpa")])),
    ];
    // `best` ranks higher than the focus shot; focus must force it in.
    expect(buildWorkingSet(shots, { cap: 1, focusCharacterIds: ["char-grandpa"] }).shots.map((s) => s.id))
      .toEqual(["best", "focus-shot"]);
  });

  it("throws MustIncludeConflict when a focus shot is also excluded", () => {
    const shots = [shot("focus", "e1", photoWithFaces(5, [face("char-grandpa")]))];
    expect(() => buildWorkingSet(shots, { excludedShotIds: ["focus"], focusCharacterIds: ["char-grandpa"] }))
      .toThrow(/keep.*leave the same moment out/i);
  });

  it("degrades gracefully when a focus id matches no face", () => {
    const shots = [shot("s", "e1", photoAnalysis(5))];
    expect(buildWorkingSet(shots, { cap: 1, focusCharacterIds: ["char-nobody"] }).shots.map((s) => s.id)).toEqual(["s"]);
  });
});

describe("compactShotLine", () => {
  it("emits the catalog fields and phase 2 analysis text", () => {
    const item = shot("s1", "e1", photoAnalysis(3), { day: "2026-05-03", place: "Park", durationSec: null });
    expect(compactShotLine(item)).toBe("s1 | photo | 2026-05-03 | Park |  | photo 3. park. warm");
  });
});
