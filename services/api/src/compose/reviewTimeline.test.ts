import { describe, expect, it } from "vitest";
import type { Timeline } from "@mosae/contracts";
import { reviewTimeline } from "./reviewTimeline.js";
import type { Candidate } from "./buildCandidates.js";

const timeline = (clips: Timeline["videoClips"]): Timeline => ({
  schemaVersion: 1, styleId: "memory", projectId: "p", mode: "memory", aspect: "9:16", fps: 30,
  durationSec: clips.reduce((n, c) => Math.max(n, c.startSec + c.durationSec), 0), chapters: [{ title: "Day 1", startSec: 0 }],
  videoClips: clips, audioClips: [], captions: [],
});
const photo = (id: string, shotId: string, startSec: number, durationSec: number): Timeline["videoClips"][number] => ({
  id, source: { kind: "photo", shotId }, startSec, durationSec, transitionIn: { kind: "cut", durationSec: 0 },
});
const video = (id: string, shotId: string, startSec: number, sourceInSec: number, sourceOutSec: number): Timeline["videoClips"][number] => ({
  id, source: { kind: "video", shotId, sourceInSec, sourceOutSec }, startSec, durationSec: sourceOutSec - sourceInSec, transitionIn: { kind: "cut", durationSec: 0 },
});
const candidate = (id: string, itemId: string, kind: Candidate["kind"], chapterIndex = 0, extra: Partial<Candidate> = {}): Candidate => ({ candidateId: id, itemId, kind, chapterIndex, description: id, ...extra });
const opts = (overrides: Partial<Parameters<typeof reviewTimeline>[1]> = {}) => ({
  candidates: new Map<string, Candidate>(), assets: new Map(), shotIdByMoment: new Map(), targetSec: 60,
  recipe: { id: "memory" as const, photoHold: [2.2, 3.2] as const, buildTightening: .15, closerHoldBoost: .3, transitions: { default: "crossfade" as const, crossfadeSec: .4, peak: "cut" as const }, photoMotion: "none" as const, cutOn: "bar" as const, musicMood: [] },
  ...overrides,
});

describe("reviewTimeline repairs", () => {
  it("extends sentence cuts to the transcript boundary and logs it", () => {
    const input = timeline([video("v", "s", 0, 2.5, 4)]);
    const result = reviewTimeline(input, opts({ transcriptByShot: new Map([["s", [{ startSec: 2, endSec: 5, text: "line" }]]]) }));
    expect((result.timeline.videoClips[0] as Timeline["videoClips"][number] & { source: { kind: "video"; shotId: string; sourceInSec: number; sourceOutSec: number } }).source.sourceInSec).toBe(2);
    expect(result.reviewNotes.some(n => n.includes("sentence"))).toBe(true);
  });
  it("swaps adjacent near-identical photos with the next distinct shot in the same chapter", () => {
    const clips = [photo("a", "s1", 0, 2.5), photo("b", "s2", 2.5, 2.5), photo("c", "s3", 5, 2.5)];
    const result = reviewTimeline(timeline(clips), opts({
      candidates: new Map([["a", candidate("a", "a", "photo", 0, { description: "blue ocean waves" })], ["b", candidate("b", "b", "photo", 0, { description: "blue ocean waves" })], ["c", candidate("c", "c", "photo", 0, { description: "family at dinner" })]]),
    }));
    expect(result.timeline.videoClips.map(c => "kind" in c ? c.clipId : c.id)).toEqual(["a", "c", "b"]);
  });
  it("clamps a photo outside the recipe range", () => {
    const result = reviewTimeline(timeline([photo("p", "s", 0, 4)]), opts());
    expect(result.timeline.videoClips[0]?.durationSec).toBe(3.2);
    expect(result.reviewNotes.some(n => n.includes("hold"))).toBe(true);
  });
  it("spreads adjacent clips from the same video", () => {
    const clips = [video("a", "same", 0, 0, 3), video("b", "same", 3, 5, 8), video("c", "other", 6, 0, 3)];
    const result = reviewTimeline(timeline(clips), opts({ candidates: new Map([["a", candidate("a", "m1", "video")], ["b", candidate("b", "m2", "video")], ["c", candidate("c", "m3", "video")]]) }));
    expect(result.timeline.videoClips.map(c => "kind" in c ? c.clipId : c.id)).toEqual(["a", "c", "b"]);
  });
  it("restores locked clip position and duration", () => {
    const input = timeline([photo("lock", "s", 1, 2)]);
    const result = reviewTimeline(input, opts({ lockedMoments: [{ clipId: "lock", startSec: 0, durationSec: 3 }] }));
    expect(result.timeline.videoClips[0]).toMatchObject({ startSec: 0, durationSec: 3 });
    expect(result.reviewNotes.some(n => n.includes("locked"))).toBe(true);
  });
  it("drops the lowest-scoring unlocked photo when more than ten percent over target", () => {
    const result = reviewTimeline(timeline([photo("a", "s1", 0, 3), photo("b", "s2", 3, 3)]), opts({ targetSec: 5, candidates: new Map([["a", candidate("a", "m1", "photo", 0, { quality: .9 })], ["b", candidate("b", "m2", "photo", 0, { quality: .1 })]]), shotIdByMoment: new Map([["m1", "s1"], ["m2", "s2"]]) }));
    expect(result.timeline.videoClips.map(c => "kind" in c ? c.clipId : c.id)).toEqual(["a"]);
    expect(result.leftOut).toEqual([{ shotId: "s2", reason: "film exceeds chosen length" }]);
  });
  it("re-snaps a photo cut that is over .25s off beat when music is present", () => {
    const input = timeline([photo("a", "s1", 0, 2.8), photo("b", "s2", 2.8, 2.5)]);
    const result = reviewTimeline(input, opts({ music: { hasPulse: true, beatsSec: [0, 2.5, 5], downbeatsSec: [0, 2.5, 5] } }));
    expect(result.timeline.videoClips[0]?.durationSec).toBe(2.5);
    expect(result.reviewNotes.some(n => n.includes("beat"))).toBe(true);
  });
  it("removes a music outro shorter than one video frame after duration fitting", () => {
    const input = timeline([photo("p", "s", 0, 2)]);
    input.audioClips = [{ id: "music-tail", source: { kind: "soundtrack", soundtrackId: "track", sourceInSec: 49.9, sourceOutSec: 49.92 }, role: "music", startSec: 4, gainDb: -6, fadeInSec: 0, fadeOutSec: 0 }];
    const result = reviewTimeline(input, opts());
    expect(result.timeline.audioClips).toEqual([]);
  });
});
