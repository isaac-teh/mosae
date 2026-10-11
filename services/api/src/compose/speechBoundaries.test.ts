import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Timeline } from "@mosae/contracts";
import { findSpeechBoundaryViolations, repairSpeechBoundaries } from "./speechBoundaries.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/speech-boundaries.json", import.meta.url), "utf8")) as {
  segments: Array<{ shotId: string; startSec: number; endSec: number; text: string }>;
};

const makeTimeline = (sourceInSec: number, sourceOutSec: number, transition: "cut" | "crossfade" = "cut", shotId = "shot"): Timeline => ({
  schemaVersion: 1, projectId: "test", mode: "creator", aspect: "16:9", fps: 30,
  durationSec: sourceOutSec - sourceInSec,
  chapters: [], audioClips: [], captions: [],
  videoClips: [{ id: "speech", source: { kind: "video", shotId, sourceInSec, sourceOutSec }, startSec: 0, durationSec: sourceOutSec - sourceInSec, transitionIn: { kind: transition, durationSec: transition === "cut" ? 0 : 0.5 } }],
});

describe("speech boundary checks", () => {
  const cases = fixture.segments.filter((segment) => [8, 4.54, 4.25].some(duration => Math.abs(segment.endSec - segment.startSec - duration) < 0.01));

  it.each(cases)("preserves the complete segment in $shotId ($startSec–$endSec)", (segment) => {
    const segments = new Map([[segment.shotId, [segment]]]);
    expect(findSpeechBoundaryViolations(makeTimeline(segment.startSec, segment.endSec, "cut", segment.shotId), segments)).toEqual([]);
  });

  it("flags a split edge and repairs it to the full segment, even with a crossfade", () => {
    const segment = fixture.segments.find((item) => Math.abs(item.endSec - item.startSec - 4.54) < 0.01)!;
    const segments = new Map([[segment.shotId, [segment]]]);
    const broken = makeTimeline(segment.startSec, 4, "crossfade", segment.shotId);
    expect(findSpeechBoundaryViolations(broken, segments)).toHaveLength(1);
    const repaired = repairSpeechBoundaries(broken, segments);
    expect(repaired.videoClips[0]).toMatchObject({ durationSec: 4.54, source: { sourceInSec: segment.startSec, sourceOutSec: segment.endSec } });
    expect(findSpeechBoundaryViolations(repaired, segments)).toEqual([]);
  });

  it("keeps a locked story clip while speech repair extends it to the full sentence", () => {
    const segment = fixture.segments.find((item) => Math.abs(item.endSec - item.startSec - 4.54) < 0.01)!;
    const segments = new Map([[segment.shotId, [segment]]]);
    const locked = makeTimeline(segment.startSec, 4, "cut", segment.shotId);
    const repaired = repairSpeechBoundaries(locked, segments);
    expect(repaired.videoClips[0]).toMatchObject({ id: "speech", source: { shotId: segment.shotId, sourceInSec: segment.startSec, sourceOutSec: segment.endSec } });
    expect(findSpeechBoundaryViolations(repaired, segments)).toEqual([]);
  });

  it("keeps an over-cap complete sentence intact when the only cut would split speech", () => {
    const segment = fixture.segments.find((item) => Math.abs(item.endSec - item.startSec - 8) < 0.01)!;
    const segments = new Map([[segment.shotId, [segment]]]);
    const timeline = makeTimeline(segment.startSec, segment.endSec, "cut", segment.shotId);
    expect(findSpeechBoundaryViolations(timeline, segments)).toEqual([]);
    expect(timeline.videoClips[0]?.durationSec).toBe(8);
  });
});
