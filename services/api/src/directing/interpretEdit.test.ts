import { describe, expect, it, vi } from "vitest";
import { applyEdits, type Timeline } from "@mosae/contracts";
import { interpretEdit, type InterpretEditModelResult } from "./interpretEdit.js";
import { EditOpSchema, type EditOp } from "@mosae/contracts";
import { DemoLimitReached } from "../gemini/errors.js";

const timeline: Timeline = {
  schemaVersion: 1, projectId: "p1", mode: "memory", aspect: "9:16", fps: 30, durationSec: 6,
  chapters: [{ title: "Snow monkeys", startSec: 0, durationSec: 6 }],
  videoClips: ["monkeys", "temple"].map((id, index) => ({ id, source: { kind: "photo", shotId: `shot-${id}` }, startSec: index * 3, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } })),
  audioClips: [], captions: [{ text: "Watching the snow monkeys", startSec: 0, endSec: 2 }],
};

function collageFixture(): Timeline {
  return { ...timeline, schemaVersion: 2, videoClips: [{ kind: "collage", clipId: "collage", startSec: 0, durationSec: 6, transitionIn: { kind: "cut", durationSec: 0 }, spec: {
    layoutId: "torn-paper", motionId: "print-drop", effectId: null, seed: "fixture", durationSec: 6,
    slots: [1, 2, 3, 4].map(index => ({ slotId: `slot-${index}`, shotId: `photo-${index}`, kind: "photo" as const })),
  } }] };
}

describe("interpretEdit", () => {
  it.each([
    {
      request: "Make it 10s with most collage", fixture: timeline,
      outputs: [], expectedOps: [
        { op: "mergeIntoCollage", clipIds: ["monkeys", "temple"] },
        { op: "setCollageDuration", clipId: "merge:monkeys", sec: 10 },
      ], reply: /^Made it 10 seconds and grouped 2 photos into a collage\.$/, duration: 10,
    },
    {
      request: "Make it 10s with more collage", fixture: timeline,
      outputs: [], expectedOps: [
        { op: "mergeIntoCollage", clipIds: ["monkeys", "temple"] },
        { op: "setCollageDuration", clipId: "merge:monkeys", sec: 10 },
      ], reply: /^Made it 10 seconds and grouped 2 photos into a collage\.$/, duration: 10,
    },
    {
      request: "focus on Jamie and make it faster", fixture: timeline,
      outputs: [], expectedOps: [{ op: "move", clipId: "temple", toIndex: 0 }], reply: /^Made it faster and brought Jamie forward\.$/,
    },
    {
      request: "landscape and change the music", fixture: timeline,
      outputs: [{ kind: "edit", ops: [{ op: "setAspect", aspect: "16:9" }] }],
      expectedOps: [{ op: "setAspect", aspect: "16:9" }, { op: "setSoundtrack", soundtrackId: "new-track" }], reply: /^Switched to landscape and changed the music to New music\.$/,
    },
    {
      request: "remove the 2nd moment and make the first one longer", fixture: timeline,
      outputs: [],
      expectedOps: [{ op: "remove", clipId: "temple" }, { op: "setPhotoDuration", clipId: "monkeys", sec: 4 }], reply: /^Removed the 2nd moment and showed the first one longer\.$/,
    },
    {
      request: "Make it 10s with no collages", fixture: collageFixture(),
      outputs: [], expectedOps: [{ op: "splitCollage", clipId: "collage" }], reply: /^Made it 10 seconds and split the collage back into single photos\.$/, duration: 10,
    },
  ])("decomposes and applies every doable request part in one batch: $request", async ({ request, fixture, outputs, expectedOps, reply, duration }) => {
    const modelCalls = outputs.length;
    const generate = vi.fn(async () => outputs.shift() ?? { kind: "edit", ops: [] });
    const context = {
      scope: { kind: "film" as const }, storyIntent: null, constraints: {},
      people: [{ personId: "jamie", name: "Jamie", role: "friend", focused: false }], selected: null,
      candidates: ["monkeys", "temple"].map(id => ({ shotId: `shot-${id}`, assetId: `asset-${id}`, kind: "photo" as const, caption: id, personIds: [id === "temple" ? "jamie" : "other"], sourceStartSec: null, sourceEndSec: null })),
      soundtracks: [{ id: "new-track", name: "New music", description: "Warm", cadence: "gentle", durationSec: 60, storagePath: "new.mp3" }], conversation: [],
    };
    const result = await interpretEdit({ text: request, timeline: fixture, groundedContext: context }, { generate });
    expect(result.kind).toBe("edit");
    if (result.kind !== "edit") return;
    for (const expected of expectedOps) expect(result.ops).toContainEqual(expected);
    expect(reply.test(result.reply)).toBe(true);
    const applied = applyEdits(fixture, result.ops);
    expect(applied.ok).toBe(true);
    if (applied.ok && duration) expect(applied.timeline.durationSec).toBeCloseTo(duration, 1);
    if (applied.ok && request === "focus on Jamie and make it faster") expect(applied.timeline.durationSec).toBeLessThan(fixture.durationSec);
    expect(generate).toHaveBeenCalledTimes(modelCalls);
  });

  describe("collage amount on a multi-photo film", () => {
    const photos = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, source: { kind: "photo" as const, shotId: `shot-p${i}` }, startSec: i * 3, durationSec: 3, transitionIn: { kind: "cut" as const, durationSec: 0 } }));
    const multi: Timeline = { ...timeline, schemaVersion: 2, durationSec: 24, chapters: [{ title: "One", startSec: 0, durationSec: 24 }], videoClips: photos, captions: [] };
    const collageCount = (t: Timeline) => t.videoClips.filter(clip => "kind" in clip).length;
    const run = async (text: string, fixture: Timeline) => {
      const generate = vi.fn();
      const result = await interpretEdit({ text, timeline: fixture }, { generate });
      expect(generate).not.toHaveBeenCalled();
      return result;
    };

    it("adds one or two collages for 'more collage'", async () => {
      const result = await run("More collage please", multi);
      expect(result.kind).toBe("edit");
      if (result.kind !== "edit") return;
      expect(result.ops.every(op => op.op === "mergeIntoCollage")).toBe(true);
      expect(result.reply).toMatch(/^Grouped \d+ photos into (?:a collage|2 collages)\.$/);
      const applied = applyEdits(multi, result.ops);
      expect(applied.ok && collageCount(applied.timeline)).toBe(2);
      expect(applied.ok && "source" in applied.timeline.videoClips[0]!).toBe(true);
      expect(applied.ok && "source" in applied.timeline.videoClips.at(-1)!).toBe(true);
    });

    it("merges every eligible group for 'most collage', then 'no collages' splits them all", async () => {
      const most = await run("most collage", multi);
      expect(most.kind).toBe("edit");
      if (most.kind !== "edit") return;
      const applied = applyEdits(multi, most.ops);
      if (!applied.ok) throw new Error(applied.error);
      expect(collageCount(applied.timeline)).toBeGreaterThanOrEqual(1);
      const none = await run("no collages", applied.timeline);
      expect(none.kind).toBe("edit");
      expect(none.reply).toMatch(/^Split (?:the collage|all collages) back into single photos\.$/);
      if (none.kind !== "edit") return;
      const split = applyEdits(applied.timeline, none.ops);
      expect(split.ok && collageCount(split.timeline)).toBe(0);
    });

    it("splits about half for 'fewer collages'", async () => {
      const withCollages = applyEdits(multi, [{ op: "mergeIntoCollage", clipIds: ["p1", "p2"] }, { op: "mergeIntoCollage", clipIds: ["p4", "p5"] }]);
      if (!withCollages.ok) throw new Error(withCollages.error);
      const fewer = await run("fewer collages", withCollages.timeline);
      expect(fewer.kind).toBe("edit");
      if (fewer.kind !== "edit") return;
      expect(fewer.ops).toEqual([{ op: "splitCollage", clipId: "merge:p4" }]);
    });

    it("applies collage changes before timing for 'Make it 10s with most collage'", async () => {
      const result = await run("Make it 10s with most collage", multi);
      expect(result.kind).toBe("edit");
      if (result.kind !== "edit") return;
      const firstTiming = result.ops.findIndex(op => op.op === "setPhotoDuration" || op.op === "setCollageDuration");
      const lastMerge = result.ops.map(op => op.op).lastIndexOf("mergeIntoCollage");
      expect(lastMerge).toBeGreaterThanOrEqual(0);
      expect(lastMerge).toBeLessThan(firstTiming);
      const applied = applyEdits(multi, result.ops);
      expect(applied.ok && applied.timeline.durationSec).toBeCloseTo(10, 1);
      expect(applied.ok && collageCount(applied.timeline)).toBeGreaterThan(0);
    });

    it("explains when no neighbouring photos can be combined", async () => {
      const lonely: Timeline = { ...multi, durationSec: 3, videoClips: [photos[0]!] };
      const result = await run("more collage", lonely);
      expect(result.kind).toBe("clarify");
    });
  });

  it("explains an unmatched focus in plain sentences while applying the pace", async () => {
    const context = {
      scope: { kind: "film" as const }, storyIntent: null, constraints: {},
      people: [{ personId: "daughter", name: "Daughter", role: "child", focused: false }, { personId: "wife", name: "Wife", role: "parent", focused: false }, { personId: "me", name: "Me", role: "self", focused: false }],
      selected: null, candidates: [], soundtracks: [], conversation: [],
    };
    const result = await interpretEdit({ text: "focus on Jamie and make it faster", timeline, groundedContext: context }, { generate: vi.fn() });
    expect(result.kind).toBe("edit");
    expect(result.reply).toBe("Made it faster. I couldn't find Jamie. Did you mean Daughter, Wife or Me?");
    expect(result.reply).not.toMatch(/skipped|operation|editor|;/i);
  });

  it("reduces collage count by splitting existing collages for fewer-collage requests", async () => {
    const first = collageFixture().videoClips[0]!;
    const second = { ...first, clipId: "collage-2", startSec: 6 };
    const fixture: Timeline = { ...timeline, schemaVersion: 2, durationSec: 12, videoClips: [first, second] };
    const result = await interpretEdit({ text: "Show fewer collages", timeline: fixture }, { generate: vi.fn() });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "splitCollage", clipId: "collage-2" }] });
    if (result.kind === "edit") {
      const applied = applyEdits(fixture, result.ops);
      expect(applied.ok).toBe(true);
      if (applied.ok) expect(applied.timeline.videoClips.filter(clip => "kind" in clip)).toHaveLength(1);
    }
  });

  const operationCases: { request: string; timeline: Timeline; op: EditOp | EditOp[]; candidates?: any[]; soundtracks?: any[] }[] = [
    { request: "Replace the monkeys photo", timeline, op: { op: "swapShot", clipId: "monkeys", shotId: "replacement", kind: "photo" }, candidates: [{ shotId: "replacement", assetId: "asset-r", kind: "photo", caption: "A lake", personIds: [], sourceStartSec: null, sourceEndSec: null }] },
    { request: "Trim the video from two to four seconds", timeline: { ...timeline, videoClips: [{ id: "video", source: { kind: "video", shotId: "video-source", sourceInSec: 0, sourceOutSec: 6, sourceDurationSec: 6 }, startSec: 0, durationSec: 6, transitionIn: { kind: "cut", durationSec: 0 } }] }, op: { op: "trim", clipId: "video", inSec: 2, outSec: 4 } },
    { request: "Hold the monkeys photo for five seconds", timeline, op: { op: "setPhotoDuration", clipId: "monkeys", sec: 5 } },
    { request: "Make the collage five seconds long", timeline: collageFixture(), op: { op: "setCollageDuration", clipId: "collage", sec: 5 } },
    { request: "Move the temple before the monkeys", timeline, op: { op: "move", clipId: "temple", toIndex: 0 } },
    { request: "Remove the temple moment", timeline, op: { op: "remove", clipId: "temple" } },
    { request: "Duplicate the monkeys moment", timeline, op: { op: "duplicate", clipId: "monkeys" } },
    { request: "Add a lake photo at the start", timeline, op: { op: "add", shotId: "replacement", kind: "photo", afterClipId: null, durationSec: 3 }, candidates: [{ shotId: "replacement", assetId: "asset-r", kind: "photo", caption: "A lake", personIds: [], sourceStartSec: null, sourceEndSec: null }] },
    { request: "Switch the collage to a photo table", timeline: collageFixture(), op: [{ op: "setCollageLayout", clipId: "collage", layoutId: "photo-table" }, { op: "setCollageMotion", clipId: "collage", motionId: "stack-deal" }] },
    { request: "Give the collage a tape slap motion", timeline: collageFixture(), op: { op: "setCollageMotion", clipId: "collage", motionId: "tape-slap" } },
    { request: "Add a warm grade to the collage", timeline: collageFixture(), op: { op: "setCollageEffect", clipId: "collage", effectId: "warm-grade" } },
    { request: "Replace the first collage photo with a lake", timeline: collageFixture(), op: { op: "replaceCollageSlot", clipId: "collage", slotId: "slot-1", shotId: "replacement", kind: "photo" }, candidates: [{ shotId: "replacement", assetId: "asset-r", kind: "photo", caption: "A lake", personIds: [], sourceStartSec: null, sourceEndSec: null }] },
    { request: "Reframe the first collage photo", timeline: collageFixture(), op: { op: "setCollageCrop", clipId: "collage", slotId: "slot-1", crop: { x: 0.5, y: 0.5, scale: 1.2 } } },
    { request: "Reframe the monkeys photo", timeline, op: { op: "setPhotoCrop", clipId: "monkeys", crop: { x: 0.4, y: 0.5, scale: 1.2 } } },
    { request: "Set a new spec for the collage", timeline: collageFixture(), op: { op: "setCollageSpec", clipId: "collage", spec: { layoutId: "torn-paper", motionId: "tape-slap", effectId: "vignette", seed: "test", durationSec: 6, slots: [1, 2, 3, 4].map(index => ({ slotId: `slot-${index}`, shotId: `photo-${index}`, kind: "photo" })) } } },
    { request: "Add a lake to the collage", timeline: collageFixture(), op: { op: "addCollageSlot", clipId: "collage", slotId: "new-slot", shotId: "replacement", kind: "photo" }, candidates: [{ shotId: "replacement", assetId: "asset-r", kind: "photo", caption: "A lake", personIds: [], sourceStartSec: null, sourceEndSec: null }] },
    { request: "Remove the first collage photo", timeline: collageFixture(), op: { op: "removeCollageSlot", clipId: "collage", slotId: "slot-1" } },
    { request: "Split the collage into separate moments", timeline: collageFixture(), op: { op: "splitCollage", clipId: "collage" } },
    { request: "Make the film landscape", timeline, op: { op: "setAspect", aspect: "16:9" } },
    { request: "Use the soft piano soundtrack", timeline, op: { op: "setSoundtrack", soundtrackId: "soft-piano" }, soundtracks: [{ id: "soft-piano", name: "Soft piano", description: "Warm", cadence: "slow", durationSec: 60, storagePath: "music/soft-piano.mp3" }] },
    { request: "Turn the music down", timeline: { ...timeline, audioClips: [{ id: "music", source: { kind: "soundtrack", soundtrackId: "soft-piano", sourceInSec: 0, sourceOutSec: 6 }, role: "music", startSec: 0, gainDb: -12, fadeInSec: 0, fadeOutSec: 0 }] }, op: { op: "setMusicVolume", audioClipId: "music", gainDb: -24 } },
  ];
  it.each(operationCases)("applies a natural-language request through the shared operation path: $request", async ({ request, timeline: fixture, op, candidates, soundtracks }) => {
    const result = await interpretEdit({ text: request, timeline: fixture, groundedContext: {
      scope: { kind: "film" }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: candidates ?? [], soundtracks: soundtracks ?? [], conversation: [],
    } }, { generate: async () => ({ kind: "edit", ops: Array.isArray(op) ? op : [op] }) });
    expect(result.kind).toBe("edit");
    if (result.kind !== "edit") return;
    const applied = applyEdits(fixture, result.ops);
    expect(applied.ok).toBe(true);
    expect(applied.ok && JSON.stringify(applied.timeline)).not.toBe(JSON.stringify(fixture));
  });

  it.each([
    { request: "Make the whole film faster", expected: [2.4, 2.4] },
    { request: "Make the whole film slower", expected: [3.6, 3.6] },
  ])("applies $request to photo and collage durations", async ({ request, expected }) => {
    const fixture: Timeline = { ...timeline, schemaVersion: 2, videoClips: [
      timeline.videoClips[0]!,
      { kind: "collage", clipId: "collage", startSec: 3, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 }, spec: {
        layoutId: "torn-paper", motionId: "print-drop", effectId: null, seed: "fixture", durationSec: 3,
        slots: [1, 2, 3, 4].map(index => ({ slotId: `slot-${index}`, shotId: `photo-${index}`, kind: "photo" as const })),
      } },
    ] };
    const result = await interpretEdit({ text: request, timeline: fixture, scope: { kind: "film" } }, { generate: vi.fn() });
    expect(result.kind).toBe("edit");
    if (result.kind === "edit") {
      expect(result.ops).toEqual([
        { op: "setPhotoDuration", clipId: "monkeys", sec: expected[0] },
        { op: "setCollageDuration", clipId: "collage", sec: expected[1] },
      ]);
      const applied = applyEdits(fixture, result.ops);
      expect(applied.ok).toBe(true);
      expect(applied.ok && applied.timeline.durationSec).not.toBe(fixture.durationSec);
    }
  });

  it("routes an upbeat soundtrack request to a track choice instead of pace", async () => {
    const audioTimeline: Timeline = { ...timeline, audioClips: [{ id: "audio-1", source: { kind: "soundtrack", soundtrackId: "soft-piano", sourceInSec: 0, sourceOutSec: 6 }, role: "music", startSec: 0, gainDb: -12, fadeInSec: 0, fadeOutSec: 0 }] };
    const groundedContext = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, people: [], selected: null, candidates: [], soundtracks: [
      { id: "soft-piano", name: "Soft piano", description: "Quiet and warm", cadence: "tender", durationSec: 60, storagePath: "music/soft-piano.mp3" },
      { id: "bright-pop", name: "Bright Pop", description: "Upbeat and bouncy", cadence: "energetic", durationSec: 60, storagePath: "music/bright-pop.mp3" },
    ], conversation: [] };
    const generate = vi.fn();
    const result = await interpretEdit({ text: "Change the soundtrack to something more upbeat", timeline: audioTimeline, groundedContext }, { generate });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "setSoundtrack", soundtrackId: "bright-pop" }] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("targets the existing soundtrack clip when turning music down", async () => {
    const audioTimeline: Timeline = { ...timeline, audioClips: [{ id: "audio-1", source: { kind: "soundtrack", soundtrackId: "soft-piano", sourceInSec: 0, sourceOutSec: 6 }, role: "music", startSec: 0, gainDb: -12, fadeInSec: 0, fadeOutSec: 0 }] };
    const groundedContext = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, people: [], selected: null, candidates: [], soundtracks: [], conversation: [] };
    const generate = vi.fn();
    const result = await interpretEdit({ text: "Turn the music down", timeline: audioTimeline, groundedContext }, { generate });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "setMusicVolume", audioClipId: "audio-1", gainDb: -18 }] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("sets the requested compatible collage layout deterministically", async () => {
    const generate = vi.fn();
    const result = await interpretEdit({ text: "Change each collage to a simple 2 by 2 grid", timeline: collageFixture(), scope: { kind: "film" } }, { generate });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "setCollageLayout", clipId: "collage", layoutId: "simple-grid-2x2" }] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("applies an each-collage layout request to the film when a photo clip is selected", async () => {
    const fixture = { ...collageFixture(), videoClips: [timeline.videoClips[0]!, collageFixture().videoClips[0]!] };
    const selectedScope = { kind: "clip" as const, clipId: "monkeys" };
    const groundedContext = { scope: selectedScope, storyIntent: null, constraints: {}, people: [], selected: { clipId: "monkeys", shotIds: ["shot-monkeys"], captions: [] }, candidates: [], soundtracks: [], conversation: [] };
    const generate = vi.fn();
    const result = await interpretEdit({ text: "Change each collage to a simple 2 by 2 grid", timeline: fixture, scope: selectedScope, groundedContext }, { generate });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "setCollageLayout", clipId: "collage", layoutId: "simple-grid-2x2" }] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("removes the requested last moment deterministically", async () => {
    const generate = vi.fn();
    const result = await interpretEdit({ text: "Remove the last moment from the film", timeline, scope: { kind: "film" } }, { generate });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "remove", clipId: "temple" }] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("moves the requested last moment to the beginning deterministically", async () => {
    const generate = vi.fn();
    const result = await interpretEdit({ text: "Move the last moment to the beginning", timeline, scope: { kind: "film" } }, { generate });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "move", clipId: "temple", toIndex: 0 }] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("moves the selected moment one position earlier", async () => {
    const scope = { kind: "clip" as const, clipId: "temple" };
    const result = await interpretEdit({ text: "Move it earlier", timeline, scope }, { generate: vi.fn() });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "move", clipId: "temple", toIndex: 0 }] });
  });

  it("moves the literal last moment one position earlier", async () => {
    const result = await interpretEdit({ text: "Move the last moment earlier", timeline, scope: { kind: "film" } }, { generate: vi.fn() });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "move", clipId: "temple", toIndex: 0 }] });
  });

  it("gives a friendly clarification when the selected moment is already first", async () => {
    const result = await interpretEdit({ text: "Move it earlier", timeline, scope: { kind: "clip", clipId: "monkeys" } }, { generate: vi.fn() });
    expect(result).toMatchObject({ kind: "clarify", reply: expect.stringMatching(/already first/i) });
  });

  it.each([
    ["Remove the last moment from the film", { op: "remove", clipId: "temple" }],
    ["Move the last moment to the beginning", { op: "move", clipId: "temple", toIndex: 0 }],
  ] as const)("resolves positional edit %s across the film despite a selected photo", async (request, op) => {
    const scope = { kind: "clip" as const, clipId: "monkeys" };
    const generate = vi.fn();
    const result = await interpretEdit({ text: request, timeline, scope, groundedContext: {
      scope, storyIntent: null, constraints: {}, selected: { clipId: "monkeys", shotIds: ["shot-monkeys"], captions: [] },
      people: [], candidates: [], soundtracks: [], conversation: [],
    } }, { generate });
    expect(result).toMatchObject({ kind: "edit", ops: [op] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("applies the selected photo duration request without asking Gemini to resolve the selected clip", async () => {
    const groundedContext = { scope: { kind: "clip" as const, clipId: "monkeys" }, storyIntent: null, constraints: {}, people: [], selected: { clipId: "monkeys", shotIds: ["shot-monkeys"], captions: [] }, candidates: [], soundtracks: [], conversation: [] };
    const generate = vi.fn();
    const result = await interpretEdit({ text: "Make this moment 5 seconds", timeline, scope: groundedContext.scope, groundedContext }, { generate });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "setPhotoDuration", clipId: "monkeys", sec: 5 }] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("reaches an attainable target film length with deterministic duration batches", async () => {
    const manyPhotos: Timeline = { ...timeline, videoClips: Array.from({ length: 12 }, (_, index) => ({ id: `photo-${index}`, source: { kind: "photo" as const, shotId: `shot-${index}` }, startSec: index * 2, durationSec: 2, transitionIn: { kind: "cut" as const, durationSec: 0 } })), durationSec: 24 };
    const generate = vi.fn();
    const result = await interpretEdit({ text: "Make the whole film 35 seconds", timeline: manyPhotos, scope: { kind: "film" } }, { generate });
    expect(result.kind).toBe("edit");
    expect(result.ops).toHaveLength(12);
    const applied = applyEdits(manyPhotos, result.ops);
    expect(applied.ok && applied.timeline.durationSec).toBeCloseTo(35, 8);
    expect(generate).not.toHaveBeenCalled();
  });

  it("matches the rendered film length across transition overlaps despite a selected photo", async () => {
    const fixture: Timeline = { ...timeline, durationSec: 5.5, videoClips: timeline.videoClips.map((clip, index) => ({
      ...clip,
      startSec: index === 0 ? 0 : 2.5,
      transitionIn: index === 0 ? { kind: "cut" as const, durationSec: 0 } : { kind: "crossfade" as const, durationSec: 0.5 },
    })) };
    const selectedScope = { kind: "clip" as const, clipId: "monkeys" };
    const groundedContext = { scope: selectedScope, storyIntent: null, constraints: {}, people: [], selected: { clipId: "monkeys", shotIds: ["shot-monkeys"], captions: [] }, candidates: [], soundtracks: [], conversation: [] };
    const generate = vi.fn();
    const result = await interpretEdit({ text: "Make the whole film 8 seconds", timeline: fixture, scope: selectedScope, groundedContext }, { generate });
    expect(result.kind).toBe("edit");
    expect(result.ops).toHaveLength(2);
    const applied = applyEdits(fixture, result.ops);
    expect(applied.ok && applied.timeline.durationSec).toBeCloseTo(8, 8);
    expect(generate).not.toHaveBeenCalled();
  });

  it("promotes an unused confirmed-person moment when that person is already represented throughout the film", async () => {
    const groundedContext = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, selected: null,
      people: [{ personId: "wife", name: "Wife", role: "parent", focused: false }],
      candidates: [
        { shotId: "shot-monkeys", assetId: "a", kind: "photo" as const, caption: "Wife at the park", personIds: ["wife"], sourceStartSec: null, sourceEndSec: null },
        { shotId: "shot-temple", assetId: "b", kind: "photo" as const, caption: "Wife at temple", personIds: ["wife"], sourceStartSec: null, sourceEndSec: null },
        { shotId: "unused-wife", assetId: "c", kind: "photo" as const, caption: "Wife smiling", personIds: ["wife"], sourceStartSec: null, sourceEndSec: null },
      ], soundtracks: [], conversation: [] };
    const generate = vi.fn();
    const result = await interpretEdit({ text: "Focus on Wife", timeline, groundedContext }, { generate });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "add", shotId: "unused-wife", kind: "photo", afterClipId: null }, { op: "setPhotoDuration", clipId: "monkeys", sec: 3.5 }, { op: "setPhotoDuration", clipId: "temple", sec: 3.5 }] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("gives a confirmed person's moments more screen time across the whole film", async () => {
    const context = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, selected: null,
      people: [{ personId: "wife", name: "Wife", role: "parent", focused: false }],
      candidates: ["shot-monkeys", "shot-temple"].map((shotId, index) => ({ shotId, assetId: `asset-${index}`, kind: "photo" as const, caption: "Wife at an event", personIds: ["wife"], sourceStartSec: null, sourceEndSec: null })), soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "Focus on Wife", timeline, groundedContext: context }, { generate: vi.fn() });
    expect(result.kind).toBe("edit");
    if (result.kind !== "edit") return;
    expect(result.ops.filter(op => op.op === "setPhotoDuration")).toHaveLength(2);
    const applied = applyEdits(timeline, result.ops);
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.timeline.videoClips.reduce((sum, clip) => sum + clip.durationSec, 0)).toBeGreaterThan(6);
  });

  it("offers Whole film when the selected clip has no match for the confirmed person", async () => {
    const groundedContext = { scope: { kind: "clip" as const, clipId: "monkeys" }, storyIntent: null, constraints: {}, selected: { clipId: "monkeys", shotIds: ["shot-monkeys"], captions: [] },
      people: [{ personId: "grandpa", name: "Grandpa", role: "other", focused: false }], candidates: [], soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "Focus on Grandpa", timeline, groundedContext }, { generate: vi.fn() });
    expect(result).toMatchObject({ kind: "clarify", ops: [] });
    expect(result.reply).toMatch(/whole film/i);
  });

  it("can focus a confirmed person by adding their unused project photo when no current moment matches", async () => {
    const groundedContext = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, selected: null,
      people: [{ personId: "grandpa", name: "Grandpa", role: "other", focused: false }],
      candidates: [{ shotId: "grandpa-photo", assetId: "asset", kind: "photo" as const, caption: "Grandpa smiling", personIds: ["grandpa"], sourceStartSec: null, sourceEndSec: null }], soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "Focus on Grandpa", timeline, groundedContext }, { generate: vi.fn() });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "add", shotId: "grandpa-photo", kind: "photo", afterClipId: null }] });
    expect(applyEdits(timeline, result.ops).ok).toBe(true);
  });

  it("updates a selected collage moment to include the missing confirmed focus", async () => {
    const fixture = collageFixture();
    const context = { scope: { kind: "clip" as const, clipId: "collage" }, storyIntent: null, constraints: {}, selected: null,
      people: [{ personId: "mia", name: "Mia", role: "child", focused: true }, { personId: "ben", name: "Ben", role: "child", focused: true }],
      candidates: [
        ...[1, 2, 3, 4].map(index => ({ shotId: `photo-${index}`, assetId: `asset-${index}`, kind: "photo" as const, caption: `Photo ${index}`, personIds: index === 1 ? ["mia"] : [], sourceStartSec: null, sourceEndSec: null })),
        { shotId: "ben-photo", assetId: "ben-asset", kind: "photo" as const, caption: "Ben outside", personIds: ["ben"], sourceStartSec: null, sourceEndSec: null },
      ], soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "Change the focus to everyone", timeline: fixture, groundedContext: context }, { generate: vi.fn() });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "replaceCollageSlot", clipId: "collage", shotId: "ben-photo", kind: "photo" }] });
    expect(applyEdits(fixture, result.ops).ok).toBe(true);
  });

  it("matches a confirmed person's full name instead of a matching substring", async () => {
    const fixture: Timeline = { ...timeline, videoClips: [
      timeline.videoClips[0]!, timeline.videoClips[1]!,
    ] };
    const groundedContext = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, selected: null,
      people: [{ personId: "al", name: "Al", role: "other", focused: false }, { personId: "malik", name: "Malik", role: "other", focused: false }],
      candidates: [
        { shotId: "shot-monkeys", assetId: "a", kind: "photo" as const, caption: "Al at the park", personIds: ["al"], sourceStartSec: null, sourceEndSec: null },
        { shotId: "shot-temple", assetId: "b", kind: "photo" as const, caption: "Malik at a temple", personIds: ["malik"], sourceStartSec: null, sourceEndSec: null },
      ], soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "Focus on Malik", timeline: fixture, groundedContext }, { generate: vi.fn() });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "move", clipId: "temple", toIndex: 0 }, { op: "setPhotoDuration", clipId: "temple", sec: 3.5 }] });
  });

  it("scales photo and collage durations to a requested film length", async () => {
    const fixture: Timeline = { ...timeline, schemaVersion: 2, videoClips: [timeline.videoClips[0]!, {
      kind: "collage", clipId: "collage", startSec: 3, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 }, spec: {
        layoutId: "torn-paper", motionId: "print-drop", effectId: null, seed: "fixture", durationSec: 3,
        slots: [1, 2, 3, 4].map(index => ({ slotId: `slot-${index}`, shotId: `photo-${index}`, kind: "photo" as const })),
      },
    }] };
    const result = await interpretEdit({ text: "Make the whole film 8 seconds", timeline: fixture }, { generate: vi.fn() });
    expect(result.kind).toBe("edit");
    if (result.kind === "edit") {
      expect(result.ops).toEqual([
        { op: "setPhotoDuration", clipId: "monkeys", sec: 4 },
        { op: "setCollageDuration", clipId: "collage", sec: 4 },
      ]);
      const applied = applyEdits(fixture, result.ops);
      expect(applied.ok && applied.timeline.durationSec).toBe(8);
    }
  });

  it.each(["Add captions", "Add a transition between moments", "Change the title", "Apply a vintage filter"])(
    "offers supported alternatives for unavailable request: %s", async (request) => {
      const generate = vi.fn();
      const result = await interpretEdit({ text: request, timeline }, { generate });
      expect(result.kind).toBe("unsupported");
      expect(result.reply).toMatch(/reorder|retime|music|framing|collage/i);
      expect(result.reply).not.toMatch(/designed to|design limitation/i);
      expect(result.ops).toEqual([]);
      expect(generate).not.toHaveBeenCalled();
    },
  );

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
    expect(result).toEqual({ kind: "edit", reply: "Reordered the moments.", ops: [{ op: "move", clipId: "monkeys", toIndex: 0 }] });
    expect(prompt).toContain('"clipIds":["monkeys","temple"]');
    expect(prompt).toContain('"chapter":"Snow monkeys"');
    expect(prompt).toContain('"caption":"Watching the snow monkeys"');
    expect(prompt).toContain('"time":"00:00–00:03"');
    expect(schema).toMatchObject({ properties: { ops: { type: "ARRAY" } } });
    const geminiSchemaKeys = new Set(["type", "format", "description", "nullable", "enum", "properties", "required", "items", "anyOf", "minimum", "maximum", "minItems", "maxItems", "propertyOrdering"]);
    const unsupportedSchemaKeys: string[] = [];
    const inspectSchema = (value: any, path = "responseSchema") => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      for (const key of Object.keys(value)) if (!geminiSchemaKeys.has(key)) unsupportedSchemaKeys.push(`${path}.${key}`);
      for (const [key, child] of Object.entries(value)) {
        if (key === "properties") for (const [name, property] of Object.entries(child as object)) inspectSchema(property, `${path}.properties.${name}`);
        else if (key === "items") inspectSchema(child, `${path}.items`);
        else if (key === "anyOf") (child as unknown[]).forEach((variant, index) => inspectSchema(variant, `${path}.anyOf[${index}]`));
      }
    };
    inspectSchema(schema);
    expect(unsupportedSchemaKeys).toEqual([]);
    expect((schema as any).properties.ops.items.anyOf.map((variant: any) => variant.properties.op.enum[0])).toEqual(EditOpSchema.options.map((variant: any) => variant.shape.op.value));
    for (const variant of EditOpSchema.options as any[]) {
      const opName = variant.shape.op.value;
      const modelVariant = (schema as any).properties.ops.items.anyOf.find((candidate: any) => candidate.properties.op.enum[0] === opName);
      expect(Object.keys(modelVariant.properties).sort(), `${opName} fields`).toEqual(Object.keys(variant.shape).sort());
      expect([...modelVariant.required].sort(), `${opName} required fields`).toEqual(Object.entries(variant.shape).filter(([, field]: any) => !field.isOptional()).map(([name]) => name).sort());
    }
    expect((schema as any).properties.ops.items.anyOf.flatMap((variant: any) => Object.values(variant.properties) as any[]).filter((field: any) => field.enum).every((field: any) => field.enum.length > 0)).toBe(true);
    expect((schema as any).properties.ops.items.anyOf.find((variant: any) => variant.properties.op.enum[0] === "setCollageMotion").properties.motionId.enum).toContain("page-turn");
    expect((schema as any).properties.ops.items.anyOf.find((variant: any) => variant.properties.op.enum[0] === "setPhotoDuration").properties.clipId.enum).toBeUndefined();
    expect((schema as any).properties.ops.items.anyOf.find((variant: any) => variant.properties.op.enum[0] === "setCollageSpec").properties.spec.properties.slots.items.properties.empty.type).toBe("BOOLEAN");
    expect(prompt).toContain('"layoutId":"photo-table","motionId":"page-turn"');
    expect(prompt).toContain("Preserve current collage sources unless changing them is necessary");
  });

  it("lists owned candidates and soundtrack ids once in the prompt instead of repeating id enums in the schema", async () => {
    let schema: any;
    let prompt = "";
    const result = await interpretEdit({ text: "replace this", timeline, groundedContext: {
      scope: { kind: "film" }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [{ shotId: "owned-shot", assetId: "owned-asset", kind: "photo", caption: "A mountain", personIds: [], sourceStartSec: null, sourceEndSec: null }],
      soundtracks: [{ id: "owned-track", name: "Piano", description: "Soft", cadence: "slow", durationSec: 60, storagePath: "music/piano.mp3" }], conversation: [],
    } }, { generate: async (options) => { schema = options.responseSchema; prompt = (options.contents as { text: string }[])[0]!.text; return { kind: "clarify", reply: "Which clip?", ops: [] }; } });
    expect(result.kind).toBe("clarify");
    const variants = schema.properties.ops.items.anyOf;
    expect(variants.find((variant: any) => variant.properties.op.enum[0] === "swapShot").properties.shotId.enum).toBeUndefined();
    expect(variants.find((variant: any) => variant.properties.op.enum[0] === "setSoundtrack").properties.soundtrackId.enum).toBeUndefined();
    expect(prompt).toContain('"shotIds":["shot-monkeys","shot-temple","owned-shot"]');
    expect(prompt).toContain('"soundtrackIds":["owned-track"]');
    expect(prompt).toContain('"shotId":"owned-shot"');
    expect(prompt).toContain('"id":"owned-track","name":"Piano"');
    expect(prompt).toContain('"collageLayouts"');
    expect(prompt).toContain('"label":"2 × 2 grid"');
  });

  it("sends selected clip IDs and the confirmed-person-to-shot map in interpreter context", async () => {
    let prompt = "";
    const groundedContext = { scope: { kind: "clip" as const, clipId: "temple" }, storyIntent: null, constraints: {}, selected: { clipId: "temple", shotIds: ["shot-temple"], captions: [] },
      people: [{ personId: "mia", name: "Mia", role: "child", focused: false }],
      candidates: [{ shotId: "shot-temple", assetId: "asset", kind: "photo" as const, caption: "Mia at the temple", personIds: ["mia"], sourceStartSec: null, sourceEndSec: null }], soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "Change the framing", timeline, groundedContext }, { generate: async options => {
      prompt = (options.contents as { text: string }[])[0]!.text;
      return { kind: "clarify", reply: "Which framing?", ops: [] };
    } });
    expect(result.kind).toBe("clarify");
    expect(prompt).toContain('"id":"temple"');
    expect(prompt).toContain('"clipId":"temple","clipIndex":1');
    expect(prompt).toContain('"selected":{"clipId":"temple","shotIds":["shot-temple"],"captions":[]}');
    expect(prompt).toContain('"peopleToMoments":[{"personId":"mia","name":"Mia","candidateShotIds":["shot-temple"]}]');
    expect(prompt).toContain('"shotId":"shot-temple","assetId":"asset"');
  });

  it("keeps the response schema under 20K and constant as film ID counts grow", async () => {
    const captureSchema = async (clipCount: number, candidateCount: number, slotCount: number) => {
      let schema: unknown;
      const clips: Timeline["videoClips"] = Array.from({ length: clipCount }, (_, index) => ({ id: `clip-${index}`, source: { kind: "photo" as const, shotId: `used-${index}` }, startSec: index, durationSec: 1, transitionIn: { kind: "cut" as const, durationSec: 0 } }));
      if (slotCount) clips[0] = { kind: "collage", clipId: "collage-large", startSec: 0, durationSec: 1, transitionIn: { kind: "cut", durationSec: 0 }, spec: {
        layoutId: "photo-table", motionId: "page-turn", effectId: null, seed: "seed", durationSec: 1,
        slots: Array.from({ length: slotCount }, (_, index) => ({ slotId: `slot-${index}`, shotId: `slot-shot-${index}`, kind: "photo" as const })),
      } };
      const context = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, people: [], selected: null,
        candidates: Array.from({ length: candidateCount }, (_, index) => ({ shotId: `candidate-${index}`, assetId: `asset-${index}`, kind: "photo" as const, caption: `Photo ${index}`, personIds: [], sourceStartSec: null, sourceEndSec: null })), soundtracks: [], conversation: [] };
      await interpretEdit({ text: "replace this", timeline: { ...timeline, schemaVersion: 2, videoClips: clips }, groundedContext: context }, {
        generate: async (options) => { schema = options.responseSchema; return { kind: "clarify", reply: "Which clip?", ops: [] }; },
      });
      return JSON.stringify(schema);
    };
    const small = await captureSchema(2, 2, 4);
    const large = await captureSchema(80, 120, 40);
    expect(large.length).toBeLessThan(20_000);
    expect(large.length).toBe(small.length);
  });

  it("normalizes the known durationSec alias and logs the repair", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await interpretEdit({ text: "change the selected photo length", timeline, scope: { kind: "clip", clipId: "monkeys" } }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "setPhotoDuration", clipId: "monkeys", durationSec: 2 }] }),
    });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "setPhotoDuration", clipId: "monkeys", sec: 2 }] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("durationSec"));
    log.mockRestore();
  });

  it("logs detailed validation failures server-side and returns a plain-language message", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalidTimeline = { ...timeline, audioClips: [{ id: "too-long", source: { kind: "soundtrack", soundtrackId: "music", sourceInSec: 0, sourceOutSec: 6 }, role: "music", startSec: 1, gainDb: 0, fadeInSec: 0, fadeOutSec: 0 }] } as Timeline;
    const result = await interpretEdit({ text: "make this shorter", timeline: invalidTimeline }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "setPhotoDuration", clipId: "monkeys", sec: 2 }] }),
    });
    expect(result.kind).toBe("unsupported");
    expect(result.reply).not.toMatch(/audioClips|sourceOutSec|clip end exceeds/i);
    expect(log).toHaveBeenCalledWith("Ask AI edit could not be applied", expect.objectContaining({ error: expect.stringContaining("audioClips.0.source.sourceOutSec") }));
    log.mockRestore();
  });

  it("normalizes the reported photo and collage duration aliases as one atomic batch", async () => {
    const collageTimeline: Timeline = {
      ...timeline,
      schemaVersion: 2,
      videoClips: [timeline.videoClips[0]!, { kind: "collage", clipId: "collage", startSec: 3, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 }, spec: {
        layoutId: "photo-table", motionId: "page-turn", effectId: null, seed: "s", durationSec: 3,
        slots: [1, 2, 3, 4].map((index) => ({ slotId: `slot-${index}`, shotId: `source-${index}`, kind: "photo" as const })),
      } }],
    };
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await interpretEdit({ text: "Use a different timing for every clip", timeline: collageTimeline }, {
      generate: async () => ({ kind: "edit", ops: [
        { op: "setPhotoDuration", clipId: "monkeys", durationSec: 2 },
        { op: "setCollageDuration", clipId: "collage", durationSec: 2 },
      ] }),
    });
    expect(result).toMatchObject({ kind: "edit", ops: [
      { op: "setPhotoDuration", clipId: "monkeys", sec: 2 },
      { op: "setCollageDuration", clipId: "collage", sec: 2 },
    ] });
    expect(warnings).toHaveBeenCalledTimes(2);
    warnings.mockRestore();
  });

  it("clarifies a collage request when no unused owned photos are available", async () => {
    const result = await interpretEdit({ text: "Add more collage", timeline, groundedContext: {
      scope: { kind: "film" }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [], soundtracks: [], conversation: [],
    } }, { generate: async () => ({ kind: "clarify", reply: "Which photos should I add to the collage?", ops: [] }) });
    expect(result).toMatchObject({ kind: "clarify", reply: expect.stringMatching(/which photos/i), ops: [] });
  });

  it("adds a collage slot only with an unused owned photo and assigns a safe slot id", async () => {
    const collageTimeline: Timeline = {
      ...timeline,
      schemaVersion: 2,
      videoClips: [{ kind: "collage", clipId: "collage", startSec: 0, durationSec: 6, transitionIn: { kind: "cut", durationSec: 0 }, spec: {
        layoutId: "photo-table", motionId: "page-turn", effectId: null, seed: "s", durationSec: 6,
        slots: [1, 2, 3, 4].map((index) => ({ slotId: `slot-${index}`, shotId: `used-${index}`, kind: "photo" as const })),
      } }],
    };
    const groundedContext = { scope: { kind: "clip" as const, clipId: "collage" }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [{ shotId: "unused-photo", assetId: "asset", kind: "photo" as const, caption: "A lake", personIds: [], sourceStartSec: null, sourceEndSec: null }], soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "Add more collage", timeline: collageTimeline, scope: groundedContext.scope, groundedContext }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "addCollageSlot", clipId: "collage", slotId: "new-slot", shotId: "unused-photo", kind: "photo" }] }),
    });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "addCollageSlot", clipId: "collage", shotId: "unused-photo" }] });
    if (result.kind === "edit") {
      expect(result.ops[0]).toMatchObject({ slotId: "ai-slot-collage-1" });
      expect(applyEdits(collageTimeline, result.ops).ok).toBe(true);
    }
  });

  it("reassigns added photos to the slot whose shape best matches their orientation", async () => {
    const collageTimeline: Timeline = { ...timeline, aspect: "16:9", schemaVersion: 2, videoClips: [{ kind: "collage", clipId: "collage", startSec: 0, durationSec: 6, transitionIn: { kind: "cut", durationSec: 0 }, spec: {
      layoutId: "grid-wide-top", motionId: "print-drop", effectId: null, seed: "s", durationSec: 6,
      slots: [
        { slotId: "portrait", shotId: "portrait", kind: "photo", width: 900, height: 1600 },
        { slotId: "wide-a", shotId: "wide-a", kind: "photo", width: 1600, height: 900 },
        { slotId: "wide-b", shotId: "wide-b", kind: "photo", width: 1600, height: 900 },
      ],
    } }] };
    const groundedContext = { scope: { kind: "clip" as const, clipId: "collage" }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [{ shotId: "wide-new", assetId: "asset", kind: "photo" as const, caption: "A lake", personIds: [], sourceStartSec: null, sourceEndSec: null, width: 1600, height: 900 }], soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "Add more collage", timeline: collageTimeline, groundedContext }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "addCollageSlot", clipId: "collage", slotId: "new-slot", shotId: "wide-new", kind: "photo" }] }),
    });
    expect(result.kind).toBe("edit");
    if (result.kind === "edit") {
      const specEdit = result.ops.find((op) => op.op === "setCollageSpec");
      expect(specEdit && specEdit.op === "setCollageSpec" ? specEdit.spec.slots.map((slot) => slot.slotId) : []).toEqual(["wide-a", "portrait", "wide-b", "ai-slot-collage-1"]);
    }
  });

  it("selects an approved larger layout when an added collage photo exceeds capacity", async () => {
    const collageTimeline: Timeline = { ...timeline, schemaVersion: 2, videoClips: [{ kind: "collage", clipId: "collage", startSec: 0, durationSec: 6, transitionIn: { kind: "cut", durationSec: 0 }, spec: {
      layoutId: "torn-paper", motionId: "print-drop", effectId: null, seed: "s", durationSec: 6,
      slots: [1, 2, 3, 4, 5].map((index) => ({ slotId: `slot-${index}`, shotId: `used-${index}`, kind: "photo" as const })),
    } }] };
    const groundedContext = { scope: { kind: "clip" as const, clipId: "collage" }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [{ shotId: "unused-photo", assetId: "asset", kind: "photo" as const, caption: "A lake", personIds: [], sourceStartSec: null, sourceEndSec: null }], soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "Add more collage", timeline: collageTimeline, groundedContext }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "addCollageSlot", clipId: "collage", slotId: "new-slot", shotId: "unused-photo", kind: "photo" }] }),
    });
    expect(result.kind).toBe("edit");
    if (result.kind === "edit") {
      expect(result.ops).toMatchObject([{ op: "setCollageLayout", clipId: "collage", layoutId: "travel-mosaic" }, { op: "addCollageSlot", clipId: "collage", shotId: "unused-photo" }]);
      expect(applyEdits(collageTimeline, result.ops).ok).toBe(true);
    }
  });

  it("asks to create a new collage when no approved layout has more capacity", async () => {
    const collageTimeline: Timeline = { ...timeline, schemaVersion: 2, videoClips: [{ kind: "collage", clipId: "collage", startSec: 0, durationSec: 6, transitionIn: { kind: "cut", durationSec: 0 }, spec: {
      layoutId: "nine-photo-grid", motionId: "print-drop", effectId: null, seed: "s", durationSec: 6,
      slots: Array.from({ length: 9 }, (_, index) => ({ slotId: `slot-${index}`, shotId: `used-${index}`, kind: "photo" as const })),
    } }] };
    const groundedContext = { scope: { kind: "clip" as const, clipId: "collage" }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [{ shotId: "unused-photo", assetId: "asset", kind: "photo" as const, caption: "A lake", personIds: [], sourceStartSec: null, sourceEndSec: null }], soundtracks: [], conversation: [] };
    const result = await interpretEdit({ text: "Add more collage", timeline: collageTimeline, groundedContext }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "addCollageSlot", clipId: "collage", slotId: "new-slot", shotId: "unused-photo", kind: "photo" }] }),
    });
    expect(result).toEqual({ kind: "clarify", reply: "That collage is full - add these as a new collage instead?", ops: [] });
  });

  it("asks which photos when a collage edit tries to use a source outside owned media", async () => {
    const collageTimeline: Timeline = {
      ...timeline,
      schemaVersion: 2,
      videoClips: [{ kind: "collage", clipId: "collage", startSec: 0, durationSec: 6, transitionIn: { kind: "cut", durationSec: 0 }, spec: {
        layoutId: "photo-table", motionId: "page-turn", effectId: null, seed: "s", durationSec: 6,
        slots: [1, 2, 3, 4].map((index) => ({ slotId: `slot-${index}`, shotId: `used-${index}`, kind: "photo" as const })),
      } }],
    };
    const result = await interpretEdit({ text: "Add more collage", timeline: collageTimeline, groundedContext: {
      scope: { kind: "clip", clipId: "collage" }, storyIntent: null, constraints: {}, people: [], selected: null, candidates: [], soundtracks: [], conversation: [],
    } }, { generate: async () => ({ kind: "edit", ops: [{ op: "addCollageSlot", clipId: "collage", slotId: "invented", shotId: "invented-photo", kind: "photo" }] }) });
    expect(result).toMatchObject({ kind: "clarify", reply: expect.stringMatching(/invented-photo|project/i), ops: [] });
  });

  it("asks before applying a whole-film request from selected-clip scope", async () => {
    const result = await interpretEdit({ text: "Adjust duration to 2s for all", timeline, scope: { kind: "clip", clipId: "monkeys" } }, {
      generate: async () => ({ kind: "clarify", reply: "Apply to all clips?", ops: [] }),
    });
    expect(result).toMatchObject({ kind: "edit", ops: [
      { op: "setPhotoDuration", clipId: "monkeys", sec: 1 },
      { op: "setPhotoDuration", clipId: "temple", sec: 1 },
    ] });
  });

  it("reports missing required operation fields in plain language", async () => {
    const result = await interpretEdit({ text: "add a clip", timeline }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "add", kind: "photo", afterClipId: "monkeys" }] }),
    });
    expect(result).toMatchObject({ kind: "clarify", reply: expect.stringMatching(/photo|which/i), ops: [] });
  });

  it("clarifies specifically when an operation references an unknown clip", async () => {
    const result = await interpretEdit({ text: "make it calmer", timeline }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "remove", clipId: "foreign-clip" }] }),
    });
    expect(result).toMatchObject({ kind: "clarify", reply: expect.stringMatching(/clip.*foreign-clip|foreign-clip.*clip/i), ops: [] });
  });

  it("returns the fallback reply when model operations are empty or invalid", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ reply: "Done", ops: [] })
      .mockResolvedValueOnce({ reply: "Done", ops: [{ op: "move", clipId: "missing", toIndex: 0 }] });
    const empty = await interpretEdit({ text: "make it calmer", timeline }, { generate });
    const invalid = await interpretEdit({ text: "make it calmer", timeline }, { generate });
    expect(empty).toEqual({ kind: "unsupported", reply: "I can reorder or trim moments, swap photos, change framing or collage layout, and adjust the soundtrack. What would you like to change?", ops: [] });
    expect(invalid).toMatchObject({ kind: "clarify", reply: expect.stringContaining("clip"), ops: [] });
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
    expect(result).toMatchObject({ kind: "clarify", reply: expect.stringMatching(/foreign-shot|project/i), ops: [] });
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

  it.each([
    ["focus on Mia", "mia"],
    ["change the focus to everyone", "everyone"],
  ])("turns the chat focus choice %s into an applicable timeline edit", async (text, focus) => {
    const focusedTimeline: Timeline = { ...timeline, videoClips: [
      { id: "unfocused", source: { kind: "photo", shotId: "shot-unfocused" }, startSec: 0, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } },
      { id: "mia", source: { kind: "photo", shotId: "shot-mia" }, startSec: 3, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } },
    ] };
    const groundedContext = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, selected: null,
      people: [{ personId: "mia-id", name: "Mia", role: "child", focused: false }, { personId: "ben-id", name: "Ben", role: "parent", focused: false }],
      candidates: [
        { shotId: "shot-unfocused", assetId: "a", kind: "photo" as const, caption: "Landscape", personIds: [], sourceStartSec: null, sourceEndSec: null },
        { shotId: "shot-mia", assetId: "b", kind: "photo" as const, caption: "Mia at the park", personIds: ["mia-id"], sourceStartSec: null, sourceEndSec: null },
      ], soundtracks: [], conversation: [] };
    const generate = vi.fn();
    const result = await interpretEdit({ text, timeline: focusedTimeline, groundedContext }, { generate });
    expect(result.kind).toBe("edit");
    expect(result.ops).toEqual([{ op: "move", clipId: "mia", toIndex: 0 }, { op: "setPhotoDuration", clipId: "mia", sec: 3.5 }]);
    expect(generate).not.toHaveBeenCalled();
    const applied = applyEdits(focusedTimeline, result.ops);
    expect(applied.ok && applied.timeline.videoClips.map(clip => "kind" in clip ? clip.clipId : clip.id)).toEqual(["mia", "unfocused"]);
    expect(result.reply.toLocaleLowerCase()).toContain(focus === "mia" ? "mia" : "everyone");
  });

  it("allows a named focus to target the whole film when a photo is selected", async () => {
    const scope = { kind: "clip" as const, clipId: "monkeys" };
    const groundedContext = { scope, storyIntent: null, constraints: {}, selected: { clipId: "monkeys", shotIds: ["shot-monkeys"], captions: [] },
      people: [{ personId: "wife-id", name: "Wife", role: "parent", focused: false }],
      candidates: [
        { shotId: "shot-monkeys", assetId: "a", kind: "photo" as const, caption: "At the park", personIds: [], sourceStartSec: null, sourceEndSec: null },
        { shotId: "wife-unused", assetId: "b", kind: "photo" as const, caption: "Wife at the beach", personIds: ["wife-id"], sourceStartSec: null, sourceEndSec: null },
      ], soundtracks: [], conversation: [] };
    const generate = vi.fn();
    const result = await interpretEdit({ text: "Focus the whole film on Wife", timeline, scope, groundedContext }, { generate });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "add", shotId: "wife-unused", afterClipId: null }] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses the owned soundtrack and accepts music gain only within supported edit bounds", async () => {
    const withMusic: Timeline = { ...timeline, audioClips: [{ id: "music", source: { kind: "soundtrack", soundtrackId: "soft-piano", sourceInSec: 0, sourceOutSec: 6 }, role: "music", startSec: 0, gainDb: -12, fadeInSec: 0, fadeOutSec: 0 }] };
    const groundedContext = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [], soundtracks: [{ id: "soft-piano", name: "Soft piano", description: "Warm", cadence: "slow", durationSec: 60, storagePath: "music/soft-piano.mp3" }], conversation: [] };
    const generate = vi.fn();
    const result = await interpretEdit({ text: "lower the music", timeline: withMusic, groundedContext }, { generate });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "setMusicVolume", audioClipId: "music", gainDb: -18 }] });
    expect(generate).not.toHaveBeenCalled();
    const invalidGain = await interpretEdit({ text: "Set music volume to 13 dB", timeline: withMusic, groundedContext }, { generate });
    expect(invalidGain).toMatchObject({ kind: "clarify", reply: expect.stringMatching(/between -60 dB and 12 dB/i), ops: [] });
  });

  it("rejects a partly invalid batch instead of returning a partial edit", async () => {
    const result = await interpretEdit({ text: "hold and replace", timeline, groundedContext: {
      scope: { kind: "film" }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [{ shotId: "owned-shot", assetId: "asset", kind: "photo", caption: "mountain", personIds: [], sourceStartSec: null, sourceEndSec: null }], soundtracks: [], conversation: [],
    } }, { generate: async () => ({ kind: "edit", ops: [
      { op: "setPhotoDuration", clipId: "monkeys", sec: 4 },
      { op: "swapShot", clipId: "temple", shotId: "foreign-shot" },
    ] }) });
    expect(result).toMatchObject({ kind: "clarify", reply: expect.stringMatching(/foreign-shot|clip/i), ops: [] });
  });

  it("retimes the requested selected moment and rejects collage operations that escape a slot", async () => {
    const clipResult = await interpretEdit({ text: "make this longer", timeline, scope: { kind: "clip", clipId: "monkeys" } }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "setPhotoDuration", clipId: "temple", sec: 4 }] }),
    });
    const slotResult = await interpretEdit({ text: "replace this photo", timeline, scope: { kind: "slot", clipId: "collage", slotId: "slot-1" } }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "setCollageDuration", clipId: "collage", sec: 5 }] }),
    });
    expect(clipResult).toMatchObject({ kind: "edit", ops: [{ op: "setPhotoDuration", clipId: "monkeys", sec: 4 }] });
    expect(slotResult).toMatchObject({ kind: "clarify", reply: expect.stringMatching(/collage|clip/i), ops: [] });
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
