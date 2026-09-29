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
    expect(result).toEqual({ reply: "Move the snow monkeys before the temple?", ops: [{ op: "move", clipId: "monkeys", toIndex: 0 }] });
    expect(prompt).toContain('"clipId":"monkeys"');
    expect(prompt).toContain('"chapter":"Snow monkeys"');
    expect(prompt).toContain('"caption":"Watching the snow monkeys"');
    expect(prompt).toContain('"time":"00:00–00:03"');
    expect(schema).toMatchObject({ properties: { ops: { type: "ARRAY" } } });
    expect((schema as any).properties.ops.items.properties.motionId.enum).toContain("page-turn");
    expect(prompt).toContain('"layoutId":"photo-table","motionId":"page-turn"');
    expect(prompt).toContain("Preserve current layout, motion, effect, and slot sources unless changing that property is necessary");
  });

  it("returns the fallback reply when model operations are empty or invalid", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ reply: "Done", ops: [] })
      .mockResolvedValueOnce({ reply: "Done", ops: [{ op: "move", clipId: "missing", toIndex: 0 }] });
    const empty = await interpretEdit({ text: "make it calmer", timeline }, { generate });
    const invalid = await interpretEdit({ text: "make it calmer", timeline }, { generate });
    expect(empty).toEqual({ reply: "I couldn't turn that into an edit. Try the tools below, or say it another way.", ops: [] });
    expect(invalid).toEqual({ reply: "I couldn't turn that into an edit. Try the tools below, or say it another way.", ops: [] });
  });

  it("lets the typed demo limit reach the API route", async () => {
    const limit = new DemoLimitReached();
    await expect(interpretEdit({ text: "make it calmer", timeline }, { generate: async () => { throw limit; } })).rejects.toBe(limit);
  });
});
