import { describe, expect, it } from "vitest";
import type { Timeline } from "@mosae/contracts";
import { applyEdits, type EditOp } from "@mosae/contracts";
import { askEditSummary, changedClipIds, suggestedAskRequests } from "./askEditUx";

const base: Timeline = { schemaVersion: 1, projectId: "p", mode: "memory", aspect: "9:16", fps: 30, durationSec: 4, chapters: [], audioClips: [], captions: [], videoClips: [{ id: "a", source: { kind: "photo", shotId: "s" }, startSec: 0, durationSec: 4, transitionIn: { kind: "cut", durationSec: 0 } }] };
describe("Ask edit UX helpers", () => {
  it("diffs changed, added, and removed clips", () => {
    const after = { ...base, videoClips: [{ ...base.videoClips[0]!, durationSec: 3 }, { ...base.videoClips[0]!, id: "b" }] };
    expect(changedClipIds(base, after)).toEqual(["a", "b"]);
    expect(changedClipIds(after, base)).toEqual(["a", "b"]);
  });
  it("summarizes supported operation types", () => {
    expect(askEditSummary([{ op: "remove", clipId: "a" }])).toBe("Removed 1 moment");
    expect(askEditSummary([{ op: "move", clipId: "a", toIndex: 0 }, { op: "move", clipId: "b", toIndex: 0 }])).toBe("Moved 2 moments earlier");
    expect(askEditSummary([{ op: "setSoundtrack", soundtrackId: "x" }], undefined, "Sandcastle Days")).toBe("Switched music to Sandcastle Days");
    expect(askEditSummary([{ op: "setAspect", aspect: "16:9" }])).toBe("Changed to landscape");
    expect(askEditSummary([{ op: "setPhotoDuration", clipId: "a", sec: 5 }])).toBe("Showed a moment longer");
    expect(askEditSummary([{ op: "trim", clipId: "a", inSec: 1, outSec: 4 }])).toBe("Trimmed a moment");
    expect(askEditSummary([{ op: "setMusicVolume", audioClipId: "music", gainDb: -4 }])).toBe("Changed music volume");
    expect(askEditSummary([{ op: "swapShot", clipId: "a", shotId: "next" }])).toBe("Replaced a moment");
    expect(askEditSummary([{ op: "add", shotId: "next", kind: "photo", afterClipId: "a", durationSec: 3 }])).toBe("Added a moment");
    expect(askEditSummary([{ op: "setCollageLayout", clipId: "a", layoutId: "grid" }])).toBe("Updated a collage");
    expect(askEditSummary([], 30)).toBe("Film is now 0:30");
    expect(askEditSummary([{ op: "setPhotoDuration", clipId: "a", sec: 6 }], 29.7)).toBe("Film is now 0:30");
    expect(askEditSummary([{ op: "setPhotoDuration", clipId: "a", sec: 5 }, { op: "setPhotoDuration", clipId: "b", sec: 5 }], 30)).toBe("Film is now 0:30");
    expect(askEditSummary([{ op: "add", shotId: "s", kind: "photo", afterClipId: null, durationSec: 3 }, { op: "move", clipId: "a", toIndex: 0 }, { op: "move", clipId: "b", toIndex: 0 }], undefined, undefined, "Focus on everyone")).toBe("Focused on everyone: moved 2 moments earlier");
    expect(askEditSummary([{ op: "move", clipId: "a", toIndex: 0 }, { op: "move", clipId: "b", toIndex: 0 }], undefined, undefined, "Focus on Wife")).toBe("Focused on Wife: moved 2 moments earlier");
    expect(askEditSummary([{ op: "remove", clipId: "a" }, { op: "setAspect", aspect: "16:9" }])).toBe("Removed 1 moment");
  });
  it("lists requests by scope and current orientation", () => {
    expect(suggestedAskRequests("film", ["Alex", "Sam", "Lee", "Jo"], "9:16")).toEqual(["Focus on everyone", "Make it faster", "Make it slower", "Make it 30 seconds", "Change the music", "Make it landscape", "Focus on Alex", "Focus on Sam", "Focus on Lee"]);
    expect(suggestedAskRequests("clip")).toEqual(["Remove this moment", "Show it longer", "Replace this photo", "Move it earlier"]);
  });
  it("describes a merge plus duration batch from the final timeline, matching the film length", () => {
    const photos = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, source: { kind: "photo" as const, shotId: `s${i}` }, startSec: i * 3, durationSec: 3, transitionIn: { kind: "cut" as const, durationSec: 0 } }));
    const film: Timeline = { ...base, schemaVersion: 2, durationSec: 18, chapters: [{ title: "One", startSec: 0, durationSec: 18 }], videoClips: photos };
    const ops: EditOp[] = [{ op: "mergeIntoCollage", clipIds: ["p1", "p2", "p3"] }, { op: "setPhotoDuration", clipId: "p0", sec: 2 }, { op: "setCollageDuration", clipId: "merge:p1", sec: 4 }, { op: "setPhotoDuration", clipId: "p4", sec: 2 }, { op: "setPhotoDuration", clipId: "p5", sec: 2 }];
    const applied = applyEdits(film, ops);
    if (!applied.ok) throw new Error(applied.error);
    const toast = askEditSummary(ops, applied.timeline.durationSec, undefined, "Make it 10s with most collage", applied.timeline);
    expect(applied.timeline.durationSec).toBe(10);
    expect(toast).toBe("Made it 10 seconds and grouped 3 photos into a collage.");
    expect(toast).not.toMatch(/;|0:\d\d/);
  });
});
