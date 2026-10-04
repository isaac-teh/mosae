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
    const result = await interpretEdit({ text: "set this to two seconds", timeline, scope: { kind: "clip", clipId: "monkeys" } }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "setPhotoDuration", clipId: "monkeys", durationSec: 2 }] }),
    });
    expect(result).toMatchObject({ kind: "edit", ops: [{ op: "setPhotoDuration", clipId: "monkeys", sec: 2 }] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("durationSec"));
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
    const result = await interpretEdit({ text: "Adjust duration to 2s for all", timeline: collageTimeline }, {
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
    expect(result).toMatchObject({ kind: "clarify", reply: "Apply to all clips?", ops: [] });
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
    expect(empty).toEqual({ kind: "unsupported", reply: "I couldn't turn that into an edit. Try the tools below, or say it another way.", ops: [] });
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

  it("uses the owned soundtrack and accepts music gain only within supported edit bounds", async () => {
    const withMusic: Timeline = { ...timeline, audioClips: [{ id: "music", source: { kind: "soundtrack", soundtrackId: "soft-piano", sourceInSec: 0, sourceOutSec: 6 }, role: "music", startSec: 0, gainDb: -12, fadeInSec: 0, fadeOutSec: 0 }] };
    const groundedContext = { scope: { kind: "film" as const }, storyIntent: null, constraints: {}, people: [], selected: null,
      candidates: [], soundtracks: [{ id: "soft-piano", name: "Soft piano", description: "Warm", cadence: "slow", durationSec: 60, storagePath: "music/soft-piano.mp3" }], conversation: [] };
    const result = await interpretEdit({ text: "lower the music", timeline: withMusic, groundedContext }, { generate: async () => ({ kind: "edit", reply: "Lowered", ops: [{ op: "setMusicVolume", audioClipId: "music", gainDb: -20 }] }) });
    expect(result.kind).toBe("edit");
    const invalidGain = await interpretEdit({ text: "raise music", timeline: withMusic, groundedContext }, { generate: async () => ({ kind: "edit", ops: [{ op: "setMusicVolume", audioClipId: "music", gainDb: 13 }] }) });
    expect(invalidGain).toMatchObject({ kind: "clarify", reply: expect.stringMatching(/required detail|invalid/i), ops: [] });
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

  it("rejects operations that escape the selected clip or collage slot", async () => {
    const clipResult = await interpretEdit({ text: "make this longer", timeline, scope: { kind: "clip", clipId: "monkeys" } }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "setPhotoDuration", clipId: "temple", sec: 4 }] }),
    });
    const slotResult = await interpretEdit({ text: "replace this photo", timeline, scope: { kind: "slot", clipId: "collage", slotId: "slot-1" } }, {
      generate: async () => ({ kind: "edit", ops: [{ op: "setCollageDuration", clipId: "collage", sec: 5 }] }),
    });
    expect(clipResult).toMatchObject({ kind: "unsupported", ops: [] });
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
