import { describe, expect, it } from "vitest";
import type { Timeline } from "@mosae/contracts";
import { aiEditPlaybackStart } from "../lib/aiEditPlayback";

const timeline: Timeline = {
  schemaVersion: 1, projectId: "p", mode: "memory", aspect: "9:16", fps: 30, durationSec: 9,
  chapters: [], audioClips: [], captions: [],
  videoClips: ["one", "two", "three"].map((id, index) => ({ id, source: { kind: "photo", shotId: id }, startSec: index * 3, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } })),
};

describe("AI edit playback target", () => {
  it("uses the previous location for a removed clip", () => {
    const after = { ...timeline, videoClips: timeline.videoClips.filter((clip) => "kind" in clip || clip.id !== "two") };
    expect(aiEditPlaybackStart([{ op: "remove", clipId: "two" }], after, timeline)).toBe(3);
  });

  it("starts after the insertion anchor for an added clip", () => {
    expect(aiEditPlaybackStart([{ op: "add", shotId: "new", kind: "photo", afterClipId: "two", durationSec: 3 }], timeline, timeline)).toBe(6);
  });

  it("starts at the affected clip for an existing edit and at film start for global edits", () => {
    expect(aiEditPlaybackStart([{ op: "setPhotoDuration", clipId: "three", sec: 4 }], timeline, timeline)).toBe(6);
    expect(aiEditPlaybackStart([{ op: "setSoundtrack", soundtrackId: "music" }], timeline, timeline)).toBe(0);
  });
});
