import { describe, expect, it } from "vitest";
import { orderPeopleByMergeSimilarity, personAnswerChips, matchExistingPersonAnswer } from "./personChips.js";

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

  it("keeps Me and My partner available so repeated answers can merge automatically", () => {
    expect(personAnswerChips("adult", ["Me"])).toEqual(["Me", "My partner", "Friend", "Type a name"]);
    expect(personAnswerChips("adult", ["My partner"])).toEqual(["Me", "My partner", "Friend", "Type a name"]);
    expect(personAnswerChips("adult", ["Me", "My partner"])).toEqual(["Me", "My partner", "Friend", "Type a name"]);
    expect(personAnswerChips(undefined, ["Me"])).toEqual(["Me", "Family", "Friend", "Type a name"]);
  });

  it("keeps repeatable relationship and family labels available", () => {
    expect(personAnswerChips("child", ["My daughter"])).toContain("My daughter");
    expect(personAnswerChips(undefined, ["Family"])).toContain("Family");
  });

  it("requires confirmation for repeated family labels and names, auto-merges Me and partner, and ignores Friend or Family", () => {
    const people = [{ personId: "first", name: "My Daughter" }, { personId: "named", name: "Ava" }];
    expect(matchExistingPersonAnswer("My daughter", people)).toEqual({ personId: "first", mode: "confirm", answer: "My daughter" });
    expect(matchExistingPersonAnswer(" ava ", people)).toEqual({ personId: "named", mode: "confirm", answer: "ava" });
    expect(matchExistingPersonAnswer("Me", [{ personId: "self", name: "Me" }])).toEqual({ personId: "self", mode: "automatic", answer: "Me" });
    expect(matchExistingPersonAnswer("My partner", [{ personId: "partner", name: "My partner" }])).toEqual({ personId: "partner", mode: "automatic", answer: "My partner" });
    expect(matchExistingPersonAnswer("Friend", [{ personId: "friend", name: "Friend" }])).toBeNull();
    expect(matchExistingPersonAnswer("Family", [{ personId: "family", name: "Family" }])).toBeNull();
  });

  it("keeps likely merge candidates together in the question order", () => {
    const ordered = orderPeopleByMergeSimilarity([
      { personId: "a", momentCount: 10 },
      { personId: "b", momentCount: 5 },
      { personId: "c", momentCount: 8, similarPersonId: "b", similarity: 0.71 },
    ]);
    expect(ordered.map(({ personId }) => personId)).toEqual(["a", "c", "b"]);
  });
});
