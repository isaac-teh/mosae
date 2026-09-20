import { describe, it, expect } from "vitest";
import type { Timeline } from "@mosae/contracts";
import { audioTrimFrames, gainToVolume, timelineMetadata } from "./timelineMetadata.js";

const timeline = (overrides: Partial<Timeline> = {}): Timeline => ({
  schemaVersion: 1,
  projectId: "p1",
  mode: "memory",
  aspect: "9:16",
  fps: 30,
  durationSec: 6,
  chapters: [],
  videoClips: [
    { id: "v1", source: { kind: "photo", shotId: "s1" }, startSec: 0, durationSec: 6, transitionIn: { kind: "cut", durationSec: 0 } },
  ],
  audioClips: [],
  captions: [],
  ...overrides,
});

describe("timelineMetadata", () => {
  it("derives the frame count from the timeline's own duration, not the clips", () => {
    expect(timelineMetadata({ props: { timeline: timeline({ durationSec: 90 }), sources: {} } }).durationInFrames).toBe(2700);
  });

  it("renders a 9:16 timeline as a portrait frame and 16:9 as landscape", () => {
    expect(timelineMetadata({ props: { timeline: timeline(), sources: {} } })).toMatchObject({ width: 1080, height: 1920 });
    expect(timelineMetadata({ props: { timeline: timeline({ aspect: "16:9" }), sources: {} } })).toMatchObject({ width: 1920, height: 1080 });
  });

  it("never returns a zero-frame composition, which Remotion rejects", () => {
    expect(timelineMetadata({ props: { timeline: timeline({ durationSec: 0.001 }), sources: {} } }).durationInFrames).toBeGreaterThanOrEqual(1);
  });

  it("rounds a fractional duration to whole frames", () => {
    expect(timelineMetadata({ props: { timeline: timeline({ durationSec: 2.017 }), sources: {} } }).durationInFrames).toBe(61);
  });

  it("carries the timeline's fps through", () => {
    expect(timelineMetadata({ props: { timeline: timeline(), sources: {} } }).fps).toBe(30);
  });
});

describe("gainToVolume", () => {
  it("maps 0 dB to unity and -20 dB to a tenth", () => {
    expect(gainToVolume(0)).toBeCloseTo(1, 6);
    expect(gainToVolume(-20)).toBeCloseTo(0.1, 6);
  });

  it("clamps to a non-negative volume", () => {
    expect(gainToVolume(-60)).toBeGreaterThanOrEqual(0);
  });
});

describe("audioTrimFrames", () => {
  it("converts audio trim points from seconds to frames", () => {
    expect(audioTrimFrames({ sourceInSec: 2, sourceOutSec: 4 }, 30).trimBeforeFrames).toBe(60);
    expect(audioTrimFrames({ sourceInSec: 0, sourceOutSec: 4 }, 30).trimBeforeFrames).toBe(0);
    expect(audioTrimFrames({ sourceInSec: 1.5, sourceOutSec: 4 }, 30)).toEqual({ trimBeforeFrames: 45, trimAfterFrames: 120 });
  });

  it("rounds fractional seconds and preserves positive clip ordering", () => {
    const trim = audioTrimFrames({ sourceInSec: 0.05, sourceOutSec: 1 }, 30);
    expect(trim.trimBeforeFrames).toBe(2);
    expect(trim.trimAfterFrames).toBeGreaterThan(trim.trimBeforeFrames);
  });
});
