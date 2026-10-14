import { describe, it, expect } from "vitest";
import { TimelineSchema, collageShotIds, parseTimeline, safeParseTimeline } from "./timeline.js";

const valid = {
  schemaVersion: 1,
  projectId: "project1",
  mode: "creator",
  aspect: "16:9",
  fps: 30,
  durationSec: 6,
  chapters: [{ title: "The market", startSec: 0 }],
  videoClips: [
    { id: "v1", source: { kind: "video", shotId: "speakerShot1", sourceInSec: 10, sourceOutSec: 12 }, startSec: 0, durationSec: 2, transitionIn: { kind: "cut", durationSec: 0 } },
    { id: "v2", source: { kind: "video", shotId: "foodShot", sourceInSec: 4, sourceOutSec: 6 }, startSec: 2, durationSec: 2, transitionIn: { kind: "cut", durationSec: 0 } },
    { id: "v3", source: { kind: "video", shotId: "speakerShot2", sourceInSec: 19, sourceOutSec: 21 }, startSec: 4, durationSec: 2, transitionIn: { kind: "cut", durationSec: 0 } },
  ],
  audioClips: [
    { id: "a1", source: { kind: "asset", assetId: "speakerAsset", sourceInSec: 10, sourceOutSec: 13, transcriptWordIds: ["w1", "w2"] }, role: "speech", startSec: 0, gainDb: 0, fadeInSec: 0, fadeOutSec: 0 },
    { id: "m1", source: { kind: "soundtrack", soundtrackId: "market-theme", sourceInSec: 0, sourceOutSec: 6 }, role: "music", startSec: 0, gainDb: -20, fadeInSec: 0.5, fadeOutSec: 0.5 },
  ],
  captions: [{ text: "We arrived at the market.", startSec: 0, endSec: 3 }],
};

describe("TimelineSchema", () => {
  const collage = {
    kind: "collage", clipId: "collage-1", startSec: 0, durationSec: 6,
    spec: {
      layoutId: "torn-paper", motionId: "print-drop", effectId: null,
      seed: "fixture", durationSec: 6,
      slots: [
        { slotId: "one", shotId: "shot-1", kind: "photo" },
        { slotId: "two", shotId: "shot-2", kind: "photo" },
        { slotId: "three", shotId: "shot-3", kind: "video" },
      ],
    },
  };

  it("keeps the v1 fixture valid and accepts a v2 collage clip", () => {
    expect(parseTimeline(valid).schemaVersion).toBe(1);
    expect(parseTimeline({ ...valid, schemaVersion: 2, videoClips: [collage] }).schemaVersion).toBe(2);
    expect(safeParseTimeline({ ...valid, videoClips: [collage] }).ok).toBe(false);
  });

  it("accepts a collage caption without a date", () => {
    const withCaption = { ...collage, spec: { ...collage.spec, caption: { place: "Day 1 · Siloso Beach" } } };
    expect(safeParseTimeline({ ...valid, schemaVersion: 2, videoClips: [withCaption] }).ok).toBe(true);
  });

  it("migrates saved invented design IDs to the closest approved library designs", () => {
    const legacy = (layoutId: string, motionId: string, count = 3) => ({
      ...collage,
      spec: { ...collage.spec, layoutId, motionId, slots: Array.from({ length: count }, (_, index) => ({ slotId: `slot-${index}`, shotId: `shot-${index}`, kind: "photo" })) },
    });
    const migrated = parseTimeline({ ...valid, schemaVersion: 2, videoClips: [
      legacy("design-polaroid", "page-turn"),
      legacy("design-magazine", "print-drop"),
      legacy("design-film-strip", "print-drop"),
      legacy("design-polaroid", "page-turn", 6),
      legacy("design-magazine", "print-drop", 1),
      legacy("design-film-strip", "print-drop", 2),
    ] });
    expect(migrated.videoClips.map((clip) => clip.kind === "collage" ? [clip.spec.layoutId, clip.spec.motionId] : null)).toEqual([
      ["polaroid-garland", "page-turn"], ["travel-story", "focus-relay"], ["postcard-stack", "stack-deal"],
      ["botanical-scrapbook", "tape-slap"], ["simple-full", "print-drop"], ["simple-stacked", "print-drop"],
    ]);
  });

  it("rejects a collage with two video cells", () => {
    const duplicateVideo = { ...collage, spec: { ...collage.spec, slots: collage.spec.slots.map((slot) => ({ ...slot, kind: "video" })) } };
    const result = safeParseTimeline({ ...valid, schemaVersion: 2, videoClips: [duplicateVideo] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("at most one video cell");
  });

  it("returns every collage slot shot ID", () => {
    const timeline = parseTimeline({ ...valid, schemaVersion: 2, videoClips: [collage] });
    expect(collageShotIds(timeline)).toEqual(["shot-1", "shot-2", "shot-3"]);
  });
  it("accepts the spec's creator example", () => {
    const timeline = parseTimeline(valid);
    expect(timeline.videoClips).toHaveLength(3);
    expect(timeline.audioClips[1].source).toMatchObject({ kind: "soundtrack", soundtrackId: "market-theme" });
  });

  it("accepts a photo clip, which carries no source timing", () => {
    const photo = { ...valid, videoClips: [{ id: "p1", source: { kind: "photo", shotId: "shot1" }, startSec: 0, durationSec: 6, transitionIn: { kind: "cut", durationSec: 0 } }] };
    const clip = parseTimeline(photo).videoClips[0];
    expect("source" in clip && clip.source.kind).toBe("photo");
  });

  it("rejects a photo clip carrying video-only source timing", () => {
    const leaky = { ...valid, videoClips: [{ id: "p1", source: { kind: "photo", shotId: "shot1", sourceInSec: 2 }, startSec: 0, durationSec: 6, transitionIn: { kind: "cut", durationSec: 0 } }] };
    const result = safeParseTimeline(leaky);
    expect(result.ok).toBe(false);
  });

  it("rejects any fps other than 30", () => {
    expect(safeParseTimeline({ ...valid, fps: 24 }).ok).toBe(false);
  });

  it("rejects non-positive clip durations and negative start times", () => {
    const zeroLength = { ...valid, videoClips: [{ ...valid.videoClips[0], durationSec: 0 }] };
    expect(safeParseTimeline(zeroLength).ok).toBe(false);
    const negativeStart = { ...valid, videoClips: [{ ...valid.videoClips[0], startSec: -1 }] };
    expect(safeParseTimeline(negativeStart).ok).toBe(false);
  });

  it("rejects an unknown transition kind and an unknown audio role", () => {
    const wipe = { ...valid, videoClips: [{ ...valid.videoClips[0], transitionIn: { kind: "wipe", durationSec: 0.5 } }] };
    expect(safeParseTimeline(wipe).ok).toBe(false);
    const role = { ...valid, audioClips: [{ ...valid.audioClips[0], role: "narration" }] };
    expect(safeParseTimeline(role).ok).toBe(false);
  });

  it("rejects unknown top-level fields so a stale snapshotId cannot ride along", () => {
    expect(safeParseTimeline({ ...valid, snapshotId: "snapshot1" }).ok).toBe(false);
  });

  it("reports readable field paths on failure", () => {
    const result = safeParseTimeline({ ...valid, durationSec: -6 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("durationSec");
  });

  it("requires at least one video clip", () => {
    expect(safeParseTimeline({ ...valid, videoClips: [] }).ok).toBe(false);
  });

  it("rejects timed tracks that run past the declared duration with field paths", () => {
    const cases = [
      [{ ...valid, videoClips: [{ ...valid.videoClips[0], startSec: 5, durationSec: 2 }] }, "videoClips.0.durationSec"],
      [{ ...valid, audioClips: [{ ...valid.audioClips[0], startSec: 5, source: { kind: "asset", assetId: "speakerAsset", sourceInSec: 0, sourceOutSec: 2 } }] }, "audioClips.0.source.sourceOutSec"],
      [{ ...valid, captions: [{ ...valid.captions[0], endSec: 7 }] }, "captions.0.endSec"],
      [{ ...valid, chapters: [{ ...valid.chapters[0], startSec: 6 }] }, "chapters.0.startSec"],
    ] as const;

    for (const [timeline, path] of cases) {
      const result = safeParseTimeline(timeline);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toContain(path);
    }
  });

  it("accepts tracks ending at the duration boundary and within tolerance", () => {
    const exactBoundary = {
      ...valid,
      videoClips: [{ ...valid.videoClips[0], startSec: 4, durationSec: 2 }],
      audioClips: [{ ...valid.audioClips[0], startSec: 4, source: { kind: "asset", assetId: "speakerAsset", sourceInSec: 0, sourceOutSec: 2 } }],
      captions: [{ ...valid.captions[0], endSec: 6 }],
      chapters: [{ ...valid.chapters[0], startSec: 5.9999995 }],
    };
    expect(safeParseTimeline(exactBoundary).ok).toBe(true);
    expect(safeParseTimeline({ ...exactBoundary, videoClips: [{ ...exactBoundary.videoClips[0], durationSec: 2.0000005 }] }).ok).toBe(true);
  });

  it("rejects tracks that exceed the duration beyond tolerance", () => {
    const result = safeParseTimeline({ ...valid, videoClips: [{ ...valid.videoClips[0], startSec: 4, durationSec: 2.01 }] });
    expect(result.ok).toBe(false);
  });

  it("exposes the schema for composition", () => {
    expect(TimelineSchema.safeParse(valid).success).toBe(true);
  });
});
