import { describe, expect, it } from "vitest";
import { applyCastGuards } from "./castGuards.js";
import type { AssembledClip } from "./assemble.js";

const clip = (itemId: string): AssembledClip => ({ candidateId: `c-${itemId}`, itemId, kind: "photo", chapterIndex: 0, description: "", order: 0, transition: "cut", audio: "mute", holdSec: 3 });
const people = new Map<string, Set<string>>([["m1", new Set(["A"])], ["m2", new Set(["A", "B", "C"])], ["m3", new Set()], ["m4", new Set(["C"])]]);
const subjects = new Map<string, Set<string>>([["m1", new Set(["A"])], ["m2", new Set(["A", "B", "C"])], ["m3", new Set()], ["m4", new Set(["C"])]]);
const run = (clips: AssembledClip[], unused: AssembledClip[] = [], core = ["A", "B", "C"], focus = ["C"], peopleByMoment = people, subjectsByMoment = subjects, chapterOf = new Map([...clips, ...unused].map((c) => [c.itemId, 1]))) => applyCastGuards({ clips, unused, core, focus, peopleByMoment, subjectsByMoment, chapterOf, label: (p) => p });

describe("applyCastGuards", () => {
  it("opens on the place and closes on the family", () => {
    const out = run([clip("m2"), clip("m1"), clip("m3")], [], ["A", "B", "C"], ["C"]);
    expect(out.clips.map((c) => c.itemId)).toEqual(["m3", "m1", "m2"]);
    expect(out.reasons).toContain("Closing on the whole family together.");
    expect(out.reasons).toContain("Opening on the place before the people.");
    expect(out).toMatchObject({ opened: true, closed: true });
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
  it("swaps in a subject photo when the focus child appears only as background", () => {
    const peopleByMoment = new Map([["background", new Set(["C"])], ["subject", new Set(["C"])]]);
    const subjectsByMoment = new Map([["background", new Set<string>()], ["subject", new Set(["C"])]]);
    const out = run([clip("background"), clip("background")], [clip("subject")], ["C"], ["C"], peopleByMoment, subjectsByMoment);
    expect(out.clips.some((c) => c.itemId === "subject")).toBe(true);
  });
  it("does not swap when the focus child is a subject in at least half of people-clips", () => {
    const peopleByMoment = new Map([["subject", new Set(["C"])], ["background", new Set(["C"])]]);
    const subjectsByMoment = new Map([["subject", new Set(["C"])], ["background", new Set<string>()]]);
    const clips = [clip("subject"), clip("background")];
    const out = run(clips, [clip("another-subject")], ["C"], ["C"], peopleByMoment, subjectsByMoment);
    expect(out.clips.map((c) => c.itemId)).toEqual(["subject", "background"]);
  });
  it("returns clips unchanged for empty cast", () => {
    const clips = [clip("m2")];
    expect(run(clips, [], [], [])).toEqual({ clips, reasons: [], opened: false, closed: false });
  });
  it("confirms already satisfied cast rules", () => {
    const out = run([clip("m2")], [], ["A", "B", "C"], ["C"]);
    expect(out.reasons).toEqual(["Everyone in the family is in the film.", "Centred the film on C.", "Closing on the whole family together."]);
  });
  it("does not close on a whole-family clip outside the final chapter", () => {
    const clips = [clip("m2"), clip("m1")];
    const out = run(clips, [], ["A", "B", "C"], ["C"], people, subjects, new Map([["m2", 1], ["m1", 2]]));
    expect(out.clips.map((c) => c.itemId)).toEqual(["m2", "m1"]);
    expect(out.reasons).not.toContain("Closing on the whole family together.");
  });
  it("can open on scenery from the first chapter", () => {
    const clips = [clip("m1"), clip("m3")];
    const out = run(clips, [], ["A"], ["A"], people, subjects, new Map([["m1", 1], ["m3", 1]]));
    expect(out.clips[0]?.itemId).toBe("m3");
  });
});
