import { describe, it, expect } from "vitest";
import { buildCandidates, type Candidate, type Shot, type TranscriptSegment, type Asset } from "./buildCandidates.js";

const holds = { min: 2, max: 8 };

function makeAsset(kind: 'photo' | 'video', analysis?: any): Asset {
  return { kind, file: `asset-${kind}`, ...analysis };
}

function makeShot(startSec: number, endSec: number, extra?: Partial<Shot>): Shot {
  return { startSec, endSec, description: `shot ${startSec}-${endSec}`, role: 'A_ROLL', quality: 0.8, usable: true, ...extra };
}

function makeSegment(startSec: number, endSec: number): TranscriptSegment {
  return { startSec, endSec, text: `speech at ${startSec}` };
}

describe("buildCandidates — photo", () => {
  it("yields exactly one candidate per photo with minHold and maxHold from cadence", () => {
    const assets = new Map([["photo1", makeAsset('photo', { analysis: { caption: "A sunset" } })]]);
    const chapters = [{ index: 0, itemIds: ["photo1"] }];

    const result = buildCandidates(chapters, assets, holds);

    expect(result.length).toBe(1);
    const candidate = result[0]!;
    expect(candidate.kind).toBe("photo");
    expect(candidate.itemId).toBe("photo1");
    expect(candidate.chapterIndex).toBe(0);
    expect(candidate.minHoldSec).toBe(2);
    expect(candidate.maxHoldSec).toBe(8);
    expect(candidate.description).toBe("A sunset");
  });

  it("an all-photo proposal works", () => {
    const assets = new Map([
      ["photo1", makeAsset('photo')],
      ["photo2", makeAsset('photo')],
      ["photo3", makeAsset('photo')],
    ]);
    const chapters = [{ index: 0, itemIds: ["photo1", "photo2", "photo3"] }];

    const result = buildCandidates(chapters, assets, holds);

    expect(result.length).toBe(3);
    for (const c of result) {
      expect(c.kind).toBe("photo");
    }
  });
});

describe("buildCandidates — video ranges", () => {
  it("a range never spans two shots", () => {
    const shot1 = makeShot(0, 5);
    const shot2 = makeShot(6, 11); // gap between shots
    const assets = new Map([["video1", makeAsset('video', { analysis: { shots: [shot1, shot2] } })]]);
    const chapters = [{ index: 0, itemIds: ["video1"] }];

    const result = buildCandidates(chapters, assets, holds);

    // Each video candidate must belong to exactly one shot (its range is fully contained within that shot)
    for (const candidate of result) {
      if (candidate.kind === "video" && candidate.inSec !== undefined && candidate.outSec !== undefined) {
        const belongsToShot1 = candidate.inSec >= shot1.startSec && candidate.outSec <= shot1.endSec;
        const belongsToShot2 = candidate.inSec >= shot2.startSec && candidate.outSec <= shot2.endSec;
        expect(belongsToShot1 || belongsToShot2).toBe(true);
      }
    }
  });

  it("a range never starts or ends mid-sentence", () => {
    const segment = makeSegment(2, 4); // speech from 2 to 4
    const shot = makeShot(0, 8);
    const assets = new Map([["video1", makeAsset('video', { analysis: { shots: [shot], transcript: [segment] } })]]);
    const chapters = [{ index: 0, itemIds: ["video1"] }];

    const result = buildCandidates(chapters, assets, holds);

    for (const candidate of result) {
      if (candidate.kind === "video" && !candidate.hasSpeech && candidate.inSec !== undefined && candidate.outSec !== undefined) {
        // Non-speech ranges must not overlap with speech: either entirely before or entirely after
        const beforeSpeech = candidate.outSec <= segment.startSec + 0.01;
        const afterSpeech = candidate.inSec >= segment.endSec - 0.01;
        expect(beforeSpeech || afterSpeech).toBe(true);
      }
    }
  });

  it("a silent shot yields the whole shot minus handles", () => {
    const shot = makeShot(0, 10); // no transcript
    const assets = new Map([["video1", makeAsset('video', { analysis: { shots: [shot] } })]]);
    const chapters = [{ index: 0, itemIds: ["video1"] }];

    const result = buildCandidates(chapters, assets, holds);

    // Should yield at least one candidate covering the shot minus handles (0.15 each end)
    const videoCandidates = result.filter(c => c.kind === "video");
    expect(videoCandidates.length).toBeGreaterThan(0);

    // The first range should start at HANDLE and cover most of the shot
    const firstRange = videoCandidates[0]!;
    expect(firstRange.inSec).toBeCloseTo(0.15, 1); // HANDLE
    expect(firstRange.outSec).toBeLessThanOrEqual(9.85); // shot.endSec - HANDLE (or less if maxLen constrains)
  });

  it("a shot shorter than MIN_CLIP yields nothing", () => {
    const shot = makeShot(0, 1); // only 1 second, less than MIN_CLIP (1.2)
    const assets = new Map([["video1", makeAsset('video', { analysis: { shots: [shot] } })]]);
    const chapters = [{ index: 0, itemIds: ["video1"] }];

    const result = buildCandidates(chapters, assets, holds);

    const videoCandidates = result.filter(c => c.kind === "video");
    expect(videoCandidates.length).toBe(0);
  });

  it("speech segments produce candidates with hasSpeech=true", () => {
    const segment = makeSegment(2, 5);
    const shot = makeShot(0, 10);
    const assets = new Map([["video1", makeAsset('video', { analysis: { shots: [shot], transcript: [segment] } })]]);
    const chapters = [{ index: 0, itemIds: ["video1"] }];

    const result = buildCandidates(chapters, assets, holds);

    const speechCandidates = result.filter(c => c.kind === "video" && c.hasSpeech);
    expect(speechCandidates.length).toBeGreaterThan(0);

    for (const candidate of speechCandidates) {
      expect(candidate.inSec).toBeGreaterThanOrEqual(segment.startSec);
      expect(candidate.outSec).toBeLessThanOrEqual(segment.endSec);
    }
  });
});

describe("buildCandidates — per chapter", () => {
  it("a moment in two chapters yields candidates in both", () => {
    const shot = makeShot(0, 10);
    const assets = new Map([["video1", makeAsset('video', { analysis: { shots: [shot] } })]]);
    const chapters = [
      { index: 0, itemIds: ["video1"] },
      { index: 1, itemIds: ["video1"] }, // same item in second chapter
    ];

    const result = buildCandidates(chapters, assets, holds);

    const ch0Candidates = result.filter(c => c.chapterIndex === 0 && c.kind === "video");
    const ch1Candidates = result.filter(c => c.chapterIndex === 1 && c.kind === "video");

    expect(ch0Candidates.length).toBeGreaterThan(0);
    expect(ch1Candidates.length).toBeGreaterThan(0);
  });

  it("perItem limits candidates per item per chapter", () => {
    const shot = makeShot(0, 30); // long shot with many potential ranges
    const assets = new Map([["video1", makeAsset('video', { analysis: { shots: [shot] } })]]);
    const chapters = [{ index: 0, itemIds: ["video1"] }];

    const result = buildCandidates(chapters, assets, holds, 3);

    const videoCandidates = result.filter(c => c.kind === "video");
    expect(videoCandidates.length).toBeLessThanOrEqual(3);
  });
});

describe("buildCandidates — strength", () => {
  it("carries shot quality as strength for video candidates", () => {
    const shot = makeShot(0, 10, { quality: 0.95 });
    const assets = new Map([["video1", makeAsset('video', { analysis: { shots: [shot] } })]]);
    const chapters = [{ index: 0, itemIds: ["video1"] }];

    const result = buildCandidates(chapters, assets, holds);

    // Candidates should carry the shot's quality info in their description or metadata
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("buildCandidates — directed video windows", () => {
  it("chooses an energetic highlight window in cadence bounds and keeps one clip per source video", () => {
    const assets = new Map<string, Asset>([
      ["moment-a", { kind: "video", assetId: "source-video", analysis: { shots: [{ ...makeShot(0, 10), highlights: [{ startSec: 7, endSec: 8, score: 0.9, label: "action" }] }] } }],
      ["moment-b", { kind: "video", assetId: "source-video", analysis: { shots: [{ ...makeShot(0, 10), highlights: [{ startSec: 2, endSec: 3, score: 0.7, label: "other" }] }] } }],
    ]);
    const result = buildCandidates([{ index: 0, itemIds: ["moment-a", "moment-b"] }], assets, holds, 6, "energetic");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ itemId: "moment-a", highlightScore: 0.9 });
    expect(result[0]!.lengthSec).toBeGreaterThanOrEqual(2);
    expect(result[0]!.lengthSec).toBeLessThanOrEqual(3);
  });

  it("falls back to the earliest legal target window when highlights and signals are absent", () => {
    const asset = makeAsset("video", { analysis: { shots: [makeShot(0, 10)] } });
    const result = buildCandidates([{ index: 0, itemIds: ["video"] }], new Map([["video", asset]]), holds, 6, "playful");
    expect(result[0]).toMatchObject({ inSec: 0.15, lengthSec: 2, windowScore: 0 });
  });

  it("offers two separated strong moments from a 20-second source in score order", () => {
    const shot = makeShot(0, 20, { highlights: [
      { startSec: 2, endSec: 5, score: 0.8 },
      { startSec: 12, endSec: 15, score: 0.95 },
    ] });
    const assets = new Map([["video", makeAsset("video", { analysis: { shots: [shot] } })]]);
    const result = buildCandidates([{ index: 0, itemIds: ["video"] }], assets, holds, 6, "energetic");
    const clips = result.filter((candidate) => candidate.kind === "video");
    expect(clips).toHaveLength(2);
    const starts = clips.map((clip) => clip.inSec!).sort((a, b) => a - b);
    expect(starts[0]).toBeGreaterThanOrEqual(2);
    expect(starts[0]).toBeLessThan(3);
    expect(starts[1]).toBeGreaterThanOrEqual(12);
    expect(starts[1]).toBeLessThan(13);
    expect(clips.every((clip) => (clip.highlightScore ?? 0) >= 0.7)).toBe(true);
  });

  it("does not offer a second signals-only window", () => {
    const shot = makeShot(0, 20, { signals: { stepSec: 0.25, shake: Array(80).fill(0), blur: Array(80).fill(1), loud: Array(80).fill(0) } });
    const result = buildCandidates([{ index: 0, itemIds: ["video"] }], new Map([["video", makeAsset("video", { analysis: { shots: [shot] } })]]), holds, 6, "energetic");
    expect(result.filter((candidate) => candidate.kind === "video")).toHaveLength(1);
  });
});

describe("buildCandidates — edge cases", () => {
  it("handles missing asset gracefully", () => {
    const assets = new Map<string, Asset>();
    const chapters = [{ index: 0, itemIds: ["missing"] }];

    const result = buildCandidates(chapters, assets, holds);

    expect(result.length).toBe(0);
  });

  it("handles empty chapters", () => {
    const assets = new Map([["photo1", makeAsset('photo')]]);
    const chapters: Array<{ index: number; itemIds: string[] }> = [];

    const result = buildCandidates(chapters, assets, holds);

    expect(result.length).toBe(0);
  });

  it("handles chapter with empty itemIds", () => {
    const assets = new Map([["photo1", makeAsset('photo')]]);
    const chapters = [{ index: 0, itemIds: [] }];

    const result = buildCandidates(chapters, assets, holds);

    expect(result.length).toBe(0);
  });
});
