import { describe, expect, it } from "vitest";
import type { EditOp } from "./edits.js";
import { describeApplied } from "./describeEdits.js";
import { parseTimeline } from "./timeline.js";

const cut = { kind: "cut" as const, durationSec: 0 };
const timeline = parseTimeline({
  schemaVersion: 2, projectId: "p", mode: "memory", aspect: "9:16", fps: 30, durationSec: 4,
  chapters: [{ title: "One", startSec: 0 }],
  videoClips: [{ id: "a", source: { kind: "photo", shotId: "sa" }, startSec: 0, durationSec: 2, transitionIn: cut }, { id: "b", source: { kind: "photo", shotId: "sb" }, startSec: 2, durationSec: 2, transitionIn: cut }],
  audioClips: [], captions: [],
});
const tracks = [{ id: "t1", name: "Sandcastle Days" }];

describe("describeApplied", () => {
  const cases: { op: EditOp; text: string; expected: RegExp }[] = [
    { op: { op: "setSoundtrack", soundtrackId: "t1" }, text: "Change the music", expected: /^Changed the music to Sandcastle Days\.$/ },
    { op: { op: "setMusicVolume", audioClipId: "x", gainDb: -18 }, text: "Turn the music down", expected: /^Changed the music volume\.$/ },
    { op: { op: "setAspect", aspect: "16:9" }, text: "Make it landscape", expected: /^Switched to (?:landscape|portrait)\.$/ },
    { op: { op: "move", clipId: "b", toIndex: 0 }, text: "Move it", expected: /^Reordered the moments\.$/ },
    { op: { op: "remove", clipId: "b" }, text: "Remove this moment", expected: /^Removed that moment\.$/ },
    { op: { op: "duplicate", clipId: "a" } as EditOp, text: "Repeat it", expected: /^Duplicated a moment\.$/ },
    { op: { op: "add", shotId: "s", kind: "photo", afterClipId: "a", durationSec: 3 } as EditOp, text: "Add a photo", expected: /^Added a moment\.$/ },
    { op: { op: "swapShot", clipId: "a", shotId: "s", kind: "photo" } as EditOp, text: "Swap it", expected: /^Replaced a photo\.$/ },
    { op: { op: "trim", clipId: "a", inSec: 0, outSec: 1 }, text: "Trim", expected: /^Changed how long moments are shown\.$/ },
    { op: { op: "setPhotoDuration", clipId: "a", sec: 3 }, text: "Show it longer", expected: /^Changed how long moments are shown\.$/ },
    { op: { op: "setPhotoCrop", clipId: "a" } as EditOp, text: "Reframe", expected: /^Adjusted the framing\.$/ },
    { op: { op: "setCollageLayout", clipId: "a", layoutId: "x" } as EditOp, text: "Change layout", expected: /^Updated the collage\.$/ },
    { op: { op: "mergeIntoCollage", clipIds: ["a", "b"] } as EditOp, text: "Collage", expected: /^Grouped 2 photos into a collage\.$/ },
  ];
  it.each(cases)("$op.op reply is a past-tense sentence", ({ op, text, expected }) => {
    const reply = describeApplied(text, [op], timeline, tracks);
    expect(reply).toMatch(expected);
    expect(reply).not.toMatch(/^I(?:'ll| will)\b/);
  });
});
