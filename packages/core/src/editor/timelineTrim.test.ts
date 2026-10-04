import { describe, expect, it } from "vitest";
import { applyEdits, parseTimeline } from "@mosae/contracts";
import { trimRange, videoTrimBounds } from "./timelineTrim";

describe("timeline trim math", () => {
  it("trims the left edge", () => {
    expect(trimRange({ startSec: 2, endSec: 5, edge: "start", requestedSec: 3, minSec: 0, maxSec: 8 }))
      .toEqual({ startSec: 3, endSec: 5 });
  });

  it("trims the right edge", () => {
    expect(trimRange({ startSec: 2, endSec: 5, edge: "end", requestedSec: 7, minSec: 0, maxSec: 8 }))
      .toEqual({ startSec: 2, endSec: 7 });
  });

  it("clamps each edge to a half-second minimum", () => {
    expect(trimRange({ startSec: 4, endSec: 5, edge: "start", requestedSec: 4.9, minSec: 0, maxSec: 8 }))
      .toEqual({ startSec: 4.5, endSec: 5 });
    expect(trimRange({ startSec: 4, endSec: 5, edge: "end", requestedSec: 4.1, minSec: 0, maxSec: 8 }))
      .toEqual({ startSec: 4, endSec: 4.5 });
  });

  it("clamps video edges to the original source bounds", () => {
    expect(trimRange({ startSec: 4, endSec: 6, edge: "start", requestedSec: 0, minSec: 3, maxSec: 7 }))
      .toEqual({ startSec: 3, endSec: 6 });
    expect(trimRange({ startSec: 4, endSec: 6, edge: "end", requestedSec: 10, minSec: 3, maxSec: 7 }))
      .toEqual({ startSec: 4, endSec: 7 });
  });

  it("uses a replaced video's available source start and end", () => {
    expect(videoTrimBounds({ sourceInSec: 4, sourceOutSec: 5, sourceStartSec: 3, sourceEndSec: 7, sourceDurationSec: 12 }))
      .toEqual({ minSec: 3, maxSec: 7 });
  });

  it("keeps AI replacement bounds available to the subsequent manual trim", () => {
    const firstCut = parseTimeline({ schemaVersion: 2, projectId: "p", mode: "memory", aspect: "9:16", fps: 30, durationSec: 3,
      chapters: [{ title: "Opening", startSec: 0 }],
      videoClips: [{ id: "clip", source: { kind: "video", shotId: "old", sourceInSec: 4, sourceOutSec: 5, sourceDurationSec: 10 }, startSec: 0, durationSec: 1, transitionIn: { kind: "cut", durationSec: 0 } }], audioClips: [], captions: [] });
    const swapped = applyEdits(firstCut, [{ op: "swapShot", clipId: "clip", shotId: "new", sourceStartSec: 3, sourceEndSec: 7 }]);
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    const clip = swapped.timeline.videoClips[0];
    if (!clip || !("source" in clip) || clip.source.kind !== "video") throw new Error("expected video replacement");
    const bounds = videoTrimBounds(clip.source);
    expect(trimRange({ startSec: clip.source.sourceInSec, endSec: clip.source.sourceOutSec, edge: "end", requestedSec: 7, minSec: bounds.minSec, maxSec: bounds.maxSec }))
      .toEqual({ startSec: 4, endSec: 7 });
  });
});
