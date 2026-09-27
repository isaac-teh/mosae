import { describe, expect, it } from "vitest";
import { applyCastGuards } from "./castGuards.js";
import type { AssembledClip } from "./assemble.js";

const clip = (itemId: string): AssembledClip => ({ candidateId: `c-${itemId}`, itemId, kind: "photo", chapterIndex: 0, description: "", order: 0, transition: "cut", audio: "mute", holdSec: 3 });
const people = new Map<string, Set<string>>([["m1", new Set(["A"])], ["m2", new Set(["A", "B", "C"])], ["m3", new Set()], ["m4", new Set(["C"])]]);
const run = (clips: AssembledClip[], unused: AssembledClip[] = [], core = ["A", "B", "C"], focus = ["C"]) => applyCastGuards({ clips, unused, core, focus, peopleByMoment: people, label: (p) => p });

describe("applyCastGuards", () => {
  it("opens on the place and closes on the family", () => {
    const out = run([clip("m2"), clip("m1"), clip("m3")], [], ["A", "B", "C"], ["C"]);
    expect(out.clips.map((c) => c.itemId)).toEqual(["m3", "m1", "m2"]);
    expect(out.reasons).toContain("Closing on the whole family together.");
    expect(out.reasons).toContain("Opening on the place before the people.");
  });
  it("adds missing core members without removing another's sole appearance", () => {
    const out = run([clip("m1"), clip("m3")], [clip("m2")]);
    expect(out.clips.map((c) => c.itemId)).toContain("m2");
    expect(out.clips.some((c) => c.itemId === "m1")).toBe(true);
  });
  it("raises focus share using available focus photos", () => {
    const out = run([clip("m1"), clip("m1")], [clip("m4")], ["A"], ["C"]);
    expect(out.clips.some((c) => c.itemId === "m4")).toBe(true);
    expect(out.reasons).toContain("Centred the film on C.");
  });
  it("returns clips unchanged for empty cast", () => {
    const clips = [clip("m2")];
    expect(run(clips, [], [], [])).toEqual({ clips, reasons: [] });
  });
});
