import { describe, it, expect } from "vitest";
import { TimelineSchema, parseTimeline, safeParseTimeline } from "./timeline.js";

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
  it("accepts the spec's creator example", () => {
    const timeline = parseTimeline(valid);
    expect(timeline.videoClips).toHaveLength(3);
    expect(timeline.audioClips[1].source).toMatchObject({ kind: "soundtrack", soundtrackId: "market-theme" });
  });

  it("accepts a photo clip, which carries no source timing", () => {
    const photo = { ...valid, videoClips: [{ id: "p1", source: { kind: "photo", shotId: "shot1" }, startSec: 0, durationSec: 6, transitionIn: { kind: "cut", durationSec: 0 } }] };
    expect(parseTimeline(photo).videoClips[0].source.kind).toBe("photo");
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

  it("exposes the schema for composition", () => {
    expect(TimelineSchema.safeParse(valid).success).toBe(true);
  });
});
