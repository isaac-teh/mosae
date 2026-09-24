import { describe, it, expect } from "vitest";
import { validateTimeline, repairOnce, type TimelineIssue, type ValidationContext } from "./validateTimeline.js";
import type { Timeline, VideoClip, AudioClip } from "@mosae/contracts";

function makeCtx(overrides?: Partial<ValidationContext>): ValidationContext {
  // Keyed by candidate id, which is also the Timeline clip id. `shotId` is the
  // shot the renderer resolves and is deliberately a different value, so a
  // lookup that confused the two would fail this fixture rather than pass it.
  const candidates = new Map<string, any>([
    ["cand-photo-1", { candidateId: "cand-photo-1", itemId: "photo-1", kind: "photo" as const, inSec: undefined, outSec: undefined, minHoldSec: 2, maxHoldSec: 6 }],
    ["cand-photo-1b", { candidateId: "cand-photo-1b", itemId: "photo-1", kind: "photo" as const, inSec: undefined, outSec: undefined, minHoldSec: 2, maxHoldSec: 6 }],
    ["cand-video-1", { candidateId: "cand-video-1", itemId: "video-1", kind: "video" as const, inSec: 0, outSec: 10, minHoldSec: undefined, maxHoldSec: undefined }],
    ["cand-photo-2", { candidateId: "cand-photo-2", itemId: "photo-2", kind: "photo" as const, inSec: undefined, outSec: undefined, minHoldSec: 2, maxHoldSec: 6 }],
  ]);

  return {
    chapters: [{ index: 0, itemIds: ["video-1", "photo-1"] }], // photo-2 is NOT in accepted chapter
    shotIds: new Set(["shot-photo-1", "shot-photo-2", "shot-video-1"]),
    // The default fixture film is one 4s photo, so 4s is the target it is
    // committed to; Rule 5 measures the film against this, not against itself.
    targetSec: 4,
    candidates,
    soundtrackIds: new Set(["soundtrack-1"]),
    ...overrides,
  };
}

function makeTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    schemaVersion: 1,
    projectId: "proj-1",
    mode: "creator" as const,
    aspect: "9:16" as const,
    fps: 30,
    durationSec: 4, // default: single photo clip at 4s — matches the default videoClips below
    chapters: [{ title: "Chapter 1", startSec: 0 }],
    videoClips: [
      {
        id: "cand-photo-1",
        source: { kind: "photo" as const, shotId: "shot-photo-1" },
        startSec: 0,
        durationSec: 4,
        transitionIn: { kind: "cut" as const, durationSec: 0 },
      } as VideoClip,
    ],
    audioClips: [] as AudioClip[],
    captions: [],
    ...overrides,
  };
}

describe("validateTimeline — semantic rules", () => {
  it("a shot from a deselected moment fails fatally", () => {
    const ctx = makeCtx(); // photo-2 is NOT in accepted chapter itemIds
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-2",
          source: { kind: "photo" as const, shotId: "shot-photo-2" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => i.severity === "fatal")).toBe(true);
    expect(issues.some(i => i.message.includes("deselected"))).toBe(true);
  });

  it("a range outside its shot fails as fixable", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-video-1",
          source: { kind: "video" as const, shotId: "shot-video-1", sourceInSec: 0, sourceOutSec: 15 }, // exceeds shot's outSec=10
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.some(i => i.message.includes("outside shot"))).toBe(true);
    expect(issues.some(i => i.severity === "fixable")).toBe(true);
  });

  it("a gap between clips fails as fixable", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
        {
          id: "cand-photo-1b",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 8, // gap of 0s (4+4=8, so no gap) — wait, let me use a bigger gap
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.some(i => i.message.includes("gap"))).toBe(true);
    expect(issues.some(i => i.severity === "fixable")).toBe(true);
  });

  it("photo hold outside cadence bounds fails as fixable", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 8, // exceeds maxHoldSec=6
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.some(i => i.message.includes("outside bounds"))).toBe(true);
    expect(issues.some(i => i.severity === "fixable")).toBe(true);
  });

  it("unknown assetId fails fatally", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      audioClips: [
        {
          id: "audio-1",
          source: { kind: "asset" as const, assetId: "unknown-asset", sourceInSec: 0, sourceOutSec: 4 },
          role: "speech" as const,
          startSec: 0,
          gainDb: 0,
          fadeInSec: 0.5,
          fadeOutSec: 0.5,
        } as AudioClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.some(i => i.message.includes("unknown asset"))).toBe(true);
    expect(issues.some(i => i.severity === "fatal")).toBe(true);
  });

  it("unknown soundtrackId fails fatally", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      audioClips: [
        {
          id: "audio-1",
          source: { kind: "soundtrack" as const, soundtrackId: "unknown-soundtrack", sourceInSec: 0, sourceOutSec: 4 },
          role: "music" as const,
          startSec: 0,
          gainDb: -6,
          fadeInSec: 1,
          fadeOutSec: 1,
        } as AudioClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.some(i => i.message.includes("unknown soundtrack"))).toBe(true);
    expect(issues.some(i => i.severity === "fatal")).toBe(true);
  });

  it("an unknown shot fails fatally, whatever built the clip", () => {
    // Rule 1 is the gate. Checking the candidate's moment against the chapters
    // the same proposal produced can only ever agree with itself; `source.shotId`
    // is the id the renderer must turn into a file, so that is what is checked.
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "m-photo-1" }, // a moment id, not a shot
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.some(i => i.message.includes("unknown shot m-photo-1"))).toBe(true);
    expect(issues.some(i => i.severity === "fatal")).toBe(true);
  });

  it("a film more than 10% short of its target fails as fixable", () => {
    // Rule 5 measures the film against the target it is committed to. Measuring
    // `durationSec` against the sum of the clip durations compares the film
    // with itself: with crossfades the two differ by exactly the overlap, so it
    // fired on every film that used one and on no film that missed its target.
    const ctx = makeCtx({ targetSec: 30 });
    const timeline = makeTimeline(); // a 4s film

    const issues = validateTimeline(timeline, ctx);

    expect(issues.some(i => i.path === "durationSec")).toBe(true);
    expect(issues.find(i => i.path === "durationSec")?.message).toContain("not within 10% of target 30s");
  });

  it("a film more than 10% over its target fails as fixable", () => {
    const ctx = makeCtx({ targetSec: 3 });
    const issues = validateTimeline(makeTimeline(), ctx); // 4s against a 3s target

    expect(issues.some(i => i.path === "durationSec")).toBe(true);
  });

  it("does not fire on a film whose crossfade overlaps shorten it within tolerance", () => {
    // The false positive that made `repairOnce` wreck real films: two clips of
    // 4s with a 0.5s crossfade run 7.5s, and the old rule compared 8 against
    // 7.5 and called it a duration failure.
    const ctx = makeCtx({ targetSec: 7.5 });
    const timeline = makeTimeline({
      durationSec: 7.5,
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
        {
          id: "cand-photo-1b",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 3.5,
          durationSec: 4,
          transitionIn: { kind: "crossfade" as const, durationSec: 0.5 },
        } as VideoClip,
      ],
    });

    expect(validateTimeline(timeline, ctx)).toEqual([]);
  });

  it("an overlap the incoming clip did not declare is fixable", () => {
    const ctx = makeCtx({ targetSec: 7.5 });
    const timeline = makeTimeline({
      durationSec: 7.5,
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "crossfade" as const, durationSec: 0.5 },
        } as VideoClip,
        {
          id: "cand-photo-1b",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 3.5,
          durationSec: 4,
          // The outgoing clip's crossfade does not license this overlap; the
          // incoming clip's would, and it declares a cut.
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);
    expect(issues.some(i => i.message.includes("without a crossfade into cand-photo-1b"))).toBe(true);
  });

  it("a valid timeline returns no issues", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4, // within bounds [2,6]
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.length).toBe(0);
  });
});

describe("repairOnce — deterministic fixes", () => {
  it("a repairable film passes on the second pass", () => {
    // The film this repairs to is one 6s photo, so 6s is the target it is
    // committed to. Leaving it at 4 would make Rule 5 fire on the repaired film.
    const ctx = makeCtx({ targetSec: 6 });
    // Photo hold exceeds maxHoldSec=6, which is fixable
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 8, // exceeds maxHoldSec=6
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);
    expect(issues.some(i => i.severity === "fixable")).toBe(true);

    const repaired = repairOnce(timeline, issues, ctx);
    if (!repaired.ok) throw new Error("expected repair to succeed");

    // Second pass should have no issues (hold was clamped to maxHoldSec=6)
    const secondIssues = validateTimeline(repaired.timeline, ctx);
    expect(secondIssues.length).toBe(0);
  });

  it("an unrepairable film returns reasons and does not throw", () => {
    const ctx = makeCtx(); // photo-2 is NOT in accepted chapter
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-2",
          source: { kind: "photo" as const, shotId: "shot-photo-2" }, // deselected moment → fatal
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);
    expect(issues.some(i => i.severity === "fatal")).toBe(true);

    const repaired = repairOnce(timeline, issues, ctx);
    expect(repaired.ok).toBe(false);
    if (!repaired.ok) {
      expect(repaired.reasons.length).toBeGreaterThan(0);
    }
  });

  it("drops the clip whose range leaves its shot and keeps the rest of the film", () => {
    const ctx = makeCtx({ targetSec: 4 });
    const timeline = makeTimeline({
      durationSec: 8,
      videoClips: [
        {
          id: "cand-video-1",
          source: { kind: "video" as const, shotId: "shot-video-1", sourceInSec: 0, sourceOutSec: 20 }, // exceeds shot's outSec=10
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 4,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);
    expect(issues.some(i => i.message.includes("outside shot"))).toBe(true);

    const repaired = repairOnce(timeline, issues, ctx);
    if (!repaired.ok) throw new Error(repaired.reasons.join("; "));
    expect(repaired.timeline.videoClips.map(c => c.id)).toEqual(["cand-photo-1"]);
    // The survivor is re-flowed to the head of the film, not left where the
    // dropped clip had put it.
    expect(repaired.timeline.videoClips[0].startSec).toBe(0);
    expect(repaired.timeline.durationSec).toBe(4);
    expect(validateTimeline(repaired.timeline, ctx)).toEqual([]);
  });

  it("refuses to repair a film down to no clips at all", () => {
    // `TimelineSchema` requires at least one video clip. Returning an empty
    // film as a successful repair hands the store something that cannot parse.
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-video-1",
          source: { kind: "video" as const, shotId: "shot-video-1", sourceInSec: 0, sourceOutSec: 20 },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const repaired = repairOnce(timeline, validateTimeline(timeline, ctx), ctx);
    expect(repaired.ok).toBe(false);
    if (!repaired.ok) expect(repaired.reasons.join("; ")).toContain("no film left");
  });

  it("reflows clip positions to be contiguous", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
        {
          id: "cand-photo-1b",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 8, // gap of 0s (4+4=8) — actually no gap here
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);
    // There should be a gap issue (8 - (0+4) = 4s gap)
    expect(issues.some(i => i.message.includes("gap"))).toBe(true);

    const repaired = repairOnce(timeline, issues, ctx);
    expect(repaired.ok).toBe(true);
    if (repaired.ok) {
      // Clip positions should be contiguous: clip-1 at 0-4s, clip-2 at 4-8s
      expect(repaired.timeline.videoClips[0]!.startSec).toBe(0);
      expect(repaired.timeline.videoClips[1]!.startSec).toBe(4);
    }
  });

  it("re-flows with the real reflow, so crossfades survive a repair", () => {
    // The repair used to be a bare cumulative walk: no quantization and no
    // overlaps, so every crossfade in the film was flattened and everything
    // laid over the picture drifted by the overlap it had destroyed.
    const ctx = makeCtx({ targetSec: 9.5 });
    const timeline = makeTimeline({
      durationSec: 12,
      chapters: [{ title: "Chapter 1", startSec: 0 }],
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 8, // over maxHoldSec=6 — the fixable issue
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
        {
          id: "cand-video-1",
          source: { kind: "video" as const, shotId: "shot-video-1", sourceInSec: 0, sourceOutSec: 4 },
          startSec: 8,
          durationSec: 4,
          transitionIn: { kind: "crossfade" as const, durationSec: 0.5 },
        } as VideoClip,
      ],
      audioClips: [
        {
          id: "audio-1",
          source: { kind: "asset" as const, assetId: "shot-video-1", sourceInSec: 0, sourceOutSec: 4 },
          role: "speech" as const,
          startSec: 8,
          gainDb: 0,
          fadeInSec: 0,
          fadeOutSec: 0,
        } as AudioClip,
      ],
      captions: [{ text: "Into the water", startSec: 8, endSec: 10 }],
    });

    const repaired = repairOnce(timeline, validateTimeline(timeline, ctx), ctx);
    if (!repaired.ok) throw new Error(repaired.reasons.join("; "));

    // The photo clamps to 6; the crossfade pulls the video back 0.5s over it.
    expect(repaired.timeline.videoClips[1].startSec).toBeCloseTo(5.5);
    expect(repaired.timeline.durationSec).toBeCloseTo(9.5);
    // The speech moves with the picture it belongs to, and stays in sync.
    expect(repaired.timeline.audioClips[0].startSec).toBeCloseTo(5.5);
    // So does the caption written over that clip.
    expect(repaired.timeline.captions[0].startSec).toBeCloseTo(5.5);
    expect(validateTimeline(repaired.timeline, ctx)).toEqual([]);
  });

  it("recomputes chapter starts against the repaired geometry", () => {
    const ctx = makeCtx({
      chapters: [
        { index: 0, itemIds: ["photo-1"] },
        { index: 1, itemIds: ["video-1"] },
      ],
      targetSec: 10,
    });
    const timeline = makeTimeline({
      durationSec: 12,
      chapters: [{ title: "One", startSec: 0 }, { title: "Two", startSec: 8 }],
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 8, // clamps to 6
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
        {
          id: "cand-video-1",
          source: { kind: "video" as const, shotId: "shot-video-1", sourceInSec: 0, sourceOutSec: 4 },
          startSec: 8,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const repaired = repairOnce(timeline, validateTimeline(timeline, ctx), ctx);
    if (!repaired.ok) throw new Error(repaired.reasons.join("; "));
    // Chapter two used to be left pointing at 8s, two seconds after the clip
    // it names actually starts.
    expect(repaired.timeline.chapters.map(c => c.startSec)).toEqual([0, 6]);
  });

  it("drops the sound of a picture the repair dropped", () => {
    const ctx = makeCtx({ targetSec: 4 });
    const timeline = makeTimeline({
      durationSec: 8,
      videoClips: [
        {
          id: "cand-video-1",
          source: { kind: "video" as const, shotId: "shot-video-1", sourceInSec: 0, sourceOutSec: 20 }, // illegal
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 4,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
      audioClips: [
        {
          id: "audio-1",
          source: { kind: "asset" as const, assetId: "shot-video-1", sourceInSec: 0, sourceOutSec: 4 },
          role: "speech" as const,
          startSec: 0,
          gainDb: 0,
          fadeInSec: 0,
          fadeOutSec: 0,
        } as AudioClip,
      ],
    });

    const repaired = repairOnce(timeline, validateTimeline(timeline, ctx), ctx);
    if (!repaired.ok) throw new Error(repaired.reasons.join("; "));
    expect(repaired.timeline.audioClips).toEqual([]);
  });

  it("stretches the soundtrack to the repaired film's length", () => {
    const ctx = makeCtx({ targetSec: 6 });
    const timeline = makeTimeline({
      durationSec: 8,
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 8, // clamps to 6
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
      audioClips: [
        {
          id: "audio-1",
          source: { kind: "soundtrack" as const, soundtrackId: "soundtrack-1", sourceInSec: 0, sourceOutSec: 8 },
          role: "music" as const,
          startSec: 0,
          gainDb: -6,
          fadeInSec: 1,
          fadeOutSec: 1,
        } as AudioClip,
      ],
    });

    const repaired = repairOnce(timeline, validateTimeline(timeline, ctx), ctx);
    if (!repaired.ok) throw new Error(repaired.reasons.join("; "));
    expect(repaired.timeline.audioClips[0].source.sourceOutSec).toBe(6);
  });

  it("no issues returns the original timeline unchanged", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);
    expect(issues.length).toBe(0);

    const repaired = repairOnce(timeline, issues, ctx);
    expect(repaired.ok).toBe(true);
    if (repaired.ok) {
      expect(repaired.timeline.videoClips[0]!.durationSec).toBe(4);
    }
  });
});
