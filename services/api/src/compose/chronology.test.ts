import { describe, expect, it } from "vitest";
import { spreadVideoClips, type ClipTime } from "./chronology.js";

type Clip = { itemId: string; kind: "photo" | "video"; inSec?: number; highlightScore?: number };
const timeOf = new Map<string, ClipTime>([
  ["p1", { chapter: 0, localTime: "2026-01-01T08:00:00", score: 0 }],
  ["p2", { chapter: 0, localTime: "2026-01-01T08:10:00", score: 0 }],
  ["p3", { chapter: 0, localTime: "2026-01-01T08:20:00", score: 0 }],
  ["p4", { chapter: 0, localTime: "2026-01-01T08:30:00", score: 0 }],
  ["v1", { chapter: 1, localTime: "2026-01-02T08:00:00", score: 0 }],
  ["v2", { chapter: 1, localTime: "2026-01-02T08:05:00", score: 0 }],
]);
const source = (clip: Clip) => clip.itemId.startsWith("v") ? "video-source" : clip.itemId;

describe("spreadVideoClips", () => {
  it("evenly distributes videos when their timestamps are in a separate cluster", () => {
    const clips: Clip[] = ["p1", "p2", "p3", "p4"].map((itemId) => ({ itemId, kind: "photo" }));
    clips.push({ itemId: "v1", kind: "video", inSec: 0 }, { itemId: "v2", kind: "video", inSec: 5 });
    expect(spreadVideoClips(clips, timeOf, source).map((clip) => clip.itemId)).toEqual(["p1", "v1", "p2", "p3", "v2", "p4"]);
  });

  it("keeps naturally interleaved timestamps and each photo sequence in time order", () => {
    const interleaved = new Map(timeOf);
    interleaved.set("v1", { chapter: 0, localTime: "2026-01-01T08:05:00", score: 0 });
    interleaved.set("v2", { chapter: 0, localTime: "2026-01-01T08:25:00", score: 0 });
    const clips: Clip[] = ["p4", "v2", "p2", "v1", "p1", "p3"].map((itemId) => ({ itemId, kind: itemId.startsWith("p") ? "photo" : "video" }));
    expect(spreadVideoClips(clips, interleaved, source).map((clip) => clip.itemId)).toEqual(["p1", "v1", "p2", "p3", "v2", "p4"]);
  });

  it("opens with a photo unless the first video is a strong highlight", () => {
    const photo: Clip = { itemId: "p1", kind: "photo" };
    const weak: Clip = { itemId: "v1", kind: "video", highlightScore: 0.6 };
    const strong: Clip = { itemId: "v1", kind: "video", highlightScore: 0.7 };
    const videoFirst = new Map<string, ClipTime>([["v1", { chapter: 0, localTime: "2025-12-31T08:00:00", score: 0 }], ["p1", { chapter: 0, localTime: "2026-01-01T08:00:00", score: 0 }]]);
    expect(spreadVideoClips([weak, photo], new Map(), source)[0]).toBe(photo);
    expect(spreadVideoClips([strong, photo], videoFirst, source)[0]).toBe(strong);
  });

  it("separates adjacent moments from the same source when a photo is available", () => {
    const clips: Clip[] = [{ itemId: "v1", kind: "video" }, { itemId: "v2", kind: "video", inSec: 5 }, { itemId: "p1", kind: "photo" }];
    const result = spreadVideoClips(clips, new Map(), source);
    expect(result.map((clip) => clip.kind)).toEqual(["video", "photo", "video"]);
  });
});
