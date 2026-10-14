import { describe, expect, it } from "vitest";
import { castSummary } from "./castSummary.js";
import type { Cast } from "./types.js";
const cast: Cast = { source: "none", confirmed: true, core: [], focus: ["child"], people: [
  { personId: "child", name: "Mia", role: "child", ageBand: "child", subjectCount: 1, appearances: 1, faceIds: [], confidence: "high" },
  { personId: "parent", name: "Mum", role: "parent", ageBand: "adult", subjectCount: 1, appearances: 1, faceIds: [], confidence: "high" },
] };
describe("explicit generation cast summary", () => {
  it("names the selected parent even when children are present", () => expect(castSummary(cast, [], new Map(), "parent")).toContain("focus: Mum;"));
  it("describes aggregate focus as everyone", () => expect(castSummary(cast, [], new Map(), "family")).toContain("focus: everyone;"));
  it("uses the chosen role for unnamed people", () => expect(castSummary({ ...cast, people: cast.people.map(person => ({ ...person, name: undefined })) }, [], new Map(), "parent")).toContain("focus: a parent;"));
  it("names all explicitly focused people", () => expect(castSummary(cast, [], new Map(), "child,parent")).toContain("focus: Mia and Mum;"));
  it("preserves legacy focus when generation focus is omitted", () => expect(castSummary(cast, [], new Map())).toContain("focus: children;"));
  it("counts user-tagged moments toward the core-together summary", () => expect(castSummary({ ...cast, core: ["parent", "child"], people: cast.people.map((person) => ({ ...person, manualShots: person.personId === "parent" ? ["s1"] : person.personId === "child" ? ["s1", "s2"] : [] })) }, [], new Map())).toContain("all core together in 1 photos"));
});
