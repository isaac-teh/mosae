import { describe, expect, it } from "vitest";
import type { Timeline } from "@mosae/contracts";
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
    expect(suggestedAskRequests("film", ["Alex", "Sam", "Lee", "Jo"], "9:16")).toEqual(["Focus on everyone", "Focus on Alex", "Focus on Sam", "Focus on Lee", "Make it faster", "Make it slower", "Change the music", "Make it 30 seconds", "Make it landscape"]);
    expect(suggestedAskRequests("clip")).toEqual(["Remove this moment", "Show it longer", "Replace this photo", "Move it earlier"]);
  });
});
