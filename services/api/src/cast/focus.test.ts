import { describe, expect, it } from "vitest";
import { chooseFocus } from "./focus.js";
import type { CastPerson } from "./types.js";

const p = (personId: string, role: CastPerson["role"], subjectCount: number, excluded = false): CastPerson =>
  ({ personId, role, subjectCount, excluded, ageBand: role === "child" ? "child" : "adult", appearances: subjectCount, faceIds: [], confidence: "high" });

describe("chooseFocus", () => {
  it("a clear leader among children is the only focus", () => {
    expect(chooseFocus([p("a", "child", 10), p("b", "child", 3), p("m", "parent", 12)], ["a", "b", "m"])).toEqual(["a"]);
  });
  it("a child at 70% or more of the leader is a co-star", () => {
    expect(chooseFocus([p("a", "child", 10), p("b", "child", 7)], ["a", "b"])).toEqual(["a", "b"]);
  });
  it("no children: the most prominent core person", () => {
    expect(chooseFocus([p("m", "parent", 4), p("d", "parent", 9)], ["m", "d"])).toEqual(["d"]);
  });
  it("never focuses an excluded person; falls back past excluded children", () => {
    expect(chooseFocus([p("a", "child", 10, true), p("m", "parent", 4), p("d", "parent", 9)], ["a", "m", "d"])).toEqual(["d"]);
  });
  it("empty cast → no focus", () => {
    expect(chooseFocus([], [])).toEqual([]);
  });
});
