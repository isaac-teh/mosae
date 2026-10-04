import { describe, expect, it, vi } from "vitest";
import type { Timeline } from "@mosae/contracts";
import { interpretEdit, type InterpretEditModelResult } from "./interpretEdit.js";
import { DemoLimitReached } from "../gemini/errors.js";

const timeline: Timeline = {
  schemaVersion: 1, projectId: "p1", mode: "memory", aspect: "9:16", fps: 30, durationSec: 6,
  chapters: [{ title: "Snow monkeys", startSec: 0, durationSec: 6 }],
  videoClips: ["monkeys", "temple"].map((id, index) => ({ id, source: { kind: "photo", shotId: `shot-${id}` }, startSec: index * 3, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } })),
  audioClips: [], captions: [{ text: "Watching the snow monkeys", startSec: 0, endSec: 2 }],
};

describe("interpretEdit", () => {
  it("interprets an edit using compact clip context and validates its operations", async () => {
    let prompt = "";
    let schema: unknown;
    const result = await interpretEdit({ text: "move the snow monkeys earlier", timeline }, {
      generate: vi.fn(async (options) => {
        prompt = (options.contents as { text: string }[])[0]!.text;
        schema = options.responseSchema;
        return { reply: "Move the snow monkeys before the temple?", ops: [{ op: "move", clipId: "monkeys", toIndex: 0 }] } satisfies InterpretEditModelResult;
      }),
    });
    expect(result).toEqual({ kind: "edit", reply: "Move the snow monkeys before the temple?", ops: [{ op: "move", clipId: "monkeys", toIndex: 0 }] });
    expect(prompt).toContain('"clipId":"monkeys"');
    expect(prompt).toContain('"chapter":"Snow monkeys"');
    expect(prompt).toContain('"caption":"Watching the snow monkeys"');
    expect(prompt).toContain('"time":"00:00–00:03"');
    expect(schema).toMatchObject({ properties: { ops: { type: "ARRAY" } } });
    expect((schema as any).properties.ops.items.properties.motionId.enum).toContain("page-turn");
    expect(prompt).toContain('"layoutId":"photo-table","motionId":"page-turn"');
    expect(prompt).toContain("Preserve current collage sources unless changing them is necessary");
  });

  it("returns the fallback reply when model operations are empty or invalid", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ reply: "Done", ops: [] })
      .mockResolvedValueOnce({ reply: "Done", ops: [{ op: "move", clipId: "missing", toIndex: 0 }] });
    const empty = await interpretEdit({ text: "make it calmer", timeline }, { generate });
    const invalid = await interpretEdit({ text: "make it calmer", timeline }, { generate });
    expect(empty).toEqual({ kind: "unsupported", reply: "I couldn't turn that into an edit. Try the tools below, or say it another way.", ops: [] });
    expect(invalid).toEqual({ kind: "unsupported", reply: "I couldn't turn that into an edit. Try the tools below, or say it another way.", ops: [] });
  });

  it("rejects source operations that are outside the owned candidate context", async () => {
    const result = await interpretEdit({
      text: "replace it",
      timeline,
      groundedContext: {
        scope: { kind: "film" }, storyIntent: null, constraints: {}, people: [], selected: null,
        candidates: [{ shotId: "owned-shot", assetId: "owned-asset", kind: "photo", caption: "A mountain", personIds: [], sourceStartSec: null, sourceEndSec: null }],
        soundtracks: [], conversation: [],
      },
    }, { generate: async () => ({ reply: "Done", ops: [{ op: "swapShot", clipId: "monkeys", shotId: "foreign-shot" }] }) });
    expect(result).toMatchObject({ kind: "unsupported", ops: [] });
  });

  it("keeps clarification distinct from unsupported requests", async () => {
    const clarify = await interpretEdit({ text: "Which one?", timeline }, { generate: async () => ({ kind: "clarify", reply: "Which clip?", ops: [] }) });
    const unsupported = await interpretEdit({ text: "Explain your reasoning", timeline }, { generate: async () => ({ kind: "unsupported", reply: "I can edit the timeline.", ops: [] }) });
    expect(clarify.kind).toBe("clarify");
    expect(unsupported.kind).toBe("unsupported");
  });

  it("clarifies duplicate confirmed display names without a model call", async () => {
    const generate = vi.fn();
    const result = await interpretEdit({ text: "focus on Alex", timeline, groundedContext: {
      scope: { kind: "film" }, storyIntent: null, constraints: {}, selected: null,
      people: [{ personId: "a", name: "Alex", role: "other", focused: false }, { personId: "b", name: "alex", role: "other", focused: false }],
      candidates: [], soundtracks: [], conversation: [],
    } }, { generate });
    expect(result).toMatchObject({ kind: "clarify", ops: [] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses the owned soundtrack and accepts music gain only within supported edit bounds", async () => {
    const withMusic: Timeline = { ...timeline, audioClips: [{ id: "music", source: { kind: "soundtrack", soundtrackId: "soft-piano", sourceInSec: 0, sourceOutSec: 6 }, role: "music", startSec: 0, gainDb: -12, fadeInSec: 0, fadeOutSec: 0 }] };
    const groundedContext = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [], soundtracks: [{ id: "soft-piano", name: "Soft piano", description: "Warm", cadence: "slow", durationSec: 60, storagePath: "music/soft-piano.mp3" }], conversation: [] };
    const result = await interpretEdit({ text: "lower the music", timeline: withMusic, groundedContext }, { generate: async () => ({ kind: "edit", reply: "Lowered", ops: [{ op: "setMusicVolume", audioClipId: "music", gainDb: -20 }] }) });
    expect(result.kind).toBe("edit");
    const invalidGain = await interpretEdit({ text: "raise music", timeline: withMusic, groundedContext }, { generate: async () => ({ kind: "edit", ops: [{ op: "setMusicVolume", audioClipId: "music", gainDb: 13 }] }) });
    expect(invalidGain).toMatchObject({ kind: "unsupported", ops: [] });
  });

  it("rejects a partly invalid batch instead of returning a partial edit", async () => {
    const result = await interpretEdit({ text: "hold and replace", timeline, groundedContext: {
      scope: { kind: "film" }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [{ shotId: "owned-shot", assetId: "asset", kind: "photo", caption: "mountain", personIds: [], sourceStartSec: null, sourceEndSec: null }], soundtracks: [], conversation: [],
    } }, { generate: async () => ({ kind: "edit", ops: [
      { op: "setPhotoDuration", clipId: "monkeys", sec: 4 },
      { op: "swapShot", clipId: "temple", shotId: "foreign-shot" },
    ] }) });
    expect(result).toMatchObject({ kind: "unsupported", ops: [] });
  });

  it("rejects operations that escape the selected clip or collage slot", async () => {
    const clipResult = await interpretEdit({ text: "make this longer", timeline, scope: { kind: "clip", clipId: "monkeys" } }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "setPhotoDuration", clipId: "temple", sec: 4 }] }),
    });
    const slotResult = await interpretEdit({ text: "replace this photo", timeline, scope: { kind: "slot", clipId: "collage", slotId: "slot-1" } }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "setCollageDuration", clipId: "collage", sec: 5 }] }),
    });
    expect(clipResult).toMatchObject({ kind: "unsupported", ops: [] });
    expect(slotResult).toMatchObject({ kind: "unsupported", ops: [] });
  });

  it("rejects swapping a video clip to a source whose bounds cannot contain the retained trim", async () => {
    const videoTimeline: Timeline = { ...timeline, videoClips: [{ id: "video", source: { kind: "video", shotId: "old", sourceInSec: 2, sourceOutSec: 5, sourceDurationSec: 8 }, startSec: 0, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } }] };
    const groundedContext = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [{ shotId: "short", assetId: "asset", kind: "video" as const, caption: "short source", personIds: [], sourceStartSec: 1, sourceEndSec: 4 }], soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "replace the clip", timeline: videoTimeline, groundedContext }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "swapShot", clipId: "video", shotId: "short" }] }),
    });
    expect(result).toMatchObject({ kind: "unsupported", ops: [] });
  });

  it("rejects a later trim in the same batch when it exceeds a replacement video duration", async () => {
    const videoTimeline: Timeline = { ...timeline, videoClips: [{ id: "video", source: { kind: "video", shotId: "old", sourceInSec: 2, sourceOutSec: 5, sourceDurationSec: 10 }, startSec: 0, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } }] };
    const groundedContext = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [{ shotId: "short", assetId: "asset", kind: "video" as const, caption: "short source", personIds: [], sourceStartSec: 0, sourceEndSec: 6 }], soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "replace then trim", timeline: videoTimeline, groundedContext }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "swapShot", clipId: "video", shotId: "short" }, { op: "trim", clipId: "video", inSec: 1, outSec: 7 }] }),
    });
    expect(result).toMatchObject({ kind: "unsupported", ops: [] });
  });

  it("rejects a later trim below a replacement video's available source start", async () => {
    const videoTimeline: Timeline = { ...timeline, videoClips: [{ id: "video", source: { kind: "video", shotId: "old", sourceInSec: 3, sourceOutSec: 5, sourceDurationSec: 10 }, startSec: 0, durationSec: 2, transitionIn: { kind: "cut", durationSec: 0 } }] };
    const groundedContext = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [{ shotId: "trimmed", assetId: "asset", kind: "video" as const, caption: "trimmed source", personIds: [], sourceStartSec: 3, sourceEndSec: 8 }], soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "replace then trim", timeline: videoTimeline, groundedContext }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "swapShot", clipId: "video", shotId: "trimmed" }, { op: "trim", clipId: "video", inSec: 2, outSec: 5 }] }),
    });
    expect(result).toMatchObject({ kind: "unsupported", ops: [] });
  });

  it("lets the typed demo limit reach the API route", async () => {
    const limit = new DemoLimitReached();
    await expect(interpretEdit({ text: "make it calmer", timeline }, { generate: async () => { throw limit; } })).rejects.toBe(limit);
  });
});
