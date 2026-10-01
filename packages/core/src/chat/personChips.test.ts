import { describe, expect, it } from "vitest";
import { personAnswerChips } from "./personChips.js";

describe("personAnswerChips", () => {
  it.each([
    ["child", ["My son", "My daughter", "Friend", "Type a name"]],
    ["teen", ["My son", "My daughter", "Friend", "Type a name"]],
    ["adult", ["Me", "My partner", "Friend", "Type a name"]],
    ["senior", ["My mum", "My dad", "Friend", "Type a name"]],
    [undefined, ["Me", "Family", "Friend", "Type a name"]],
  ] as const)("uses %s age chips", (ageBand, expected) => {
    expect(personAnswerChips(ageBand)).toEqual(expected);
  });

  it("hides Me and My partner when either answer is already assigned", () => {
    expect(personAnswerChips("adult", ["Me"])).toEqual(["My partner", "Friend", "Type a name"]);
    expect(personAnswerChips("adult", ["My partner"])).toEqual(["Me", "Friend", "Type a name"]);
    expect(personAnswerChips("adult", ["Me", "My partner"])).toEqual(["Friend", "Type a name"]);
    expect(personAnswerChips(undefined, ["Me"])).toEqual(["Family", "Friend", "Type a name"]);
  });

  it("keeps repeatable relationship and family labels available", () => {
    expect(personAnswerChips("child", ["My daughter"])).toContain("My daughter");
    expect(personAnswerChips(undefined, ["Family"])).toContain("Family");
  });
});
