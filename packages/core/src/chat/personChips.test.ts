import { describe, expect, it } from "vitest";
import { mainPeople, orderPeopleByMergeSimilarity, personAnswerChips, matchExistingPersonAnswer } from "./personChips.js";

describe("mainPeople", () => {
  it("keeps frequent foreground clusters, sorts by moments, and caps the flow at five", () => {
    const clusters = [
      { personId: "rare", momentCount: 1 }, { personId: "background", momentCount: 20, backgroundOnly: true },
      ...Array.from({ length: 6 }, (_, i) => ({ personId: `p${i}`, momentCount: 10 - i })),
    ];
    expect(mainPeople(clusters, 100).map(({ personId }) => personId)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("includes clusters appearing in at least ten percent of shots", () => {
    expect(mainPeople([{ personId: "ten-percent", momentCount: 10 }, { personId: "below", momentCount: 1 }], 100).map(({ personId }) => personId)).toEqual(["ten-percent"]);
  });

  it("retains a previously surfaced pending cluster when face reconciliation leaves one photo", () => {
    expect(mainPeople([{ personId: "pending", momentCount: 1, forceShow: true }], 100).map(({ personId }) => personId)).toEqual(["pending"]);
  });
});

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

  it("automatically merges repeated names and relationship labels, and ignores Friend or Family", () => {
    const people = [{ personId: "first", name: "My Daughter" }, { personId: "named", name: "Ava" }];
    expect(matchExistingPersonAnswer("My daughter", people)).toEqual({ personId: "first", mode: "automatic", answer: "Daughter" });
    expect(matchExistingPersonAnswer(" ava ", people)).toEqual({ personId: "named", mode: "automatic", answer: "Ava" });
    expect(matchExistingPersonAnswer("mE", [{ personId: "self", name: "Me" }])).toEqual({ personId: "self", mode: "automatic", answer: "Me" });
    expect(matchExistingPersonAnswer("My partner", [{ personId: "partner", name: "My partner" }])).toEqual({ personId: "partner", mode: "automatic", answer: "partner" });
    expect(matchExistingPersonAnswer("Friend", [{ personId: "friend", name: "Friend" }])).toBeNull();
    expect(matchExistingPersonAnswer("Family", [{ personId: "family", name: "Family" }])).toBeNull();
  });

  it("recognizes a previously tagged person in a natural repeat answer", () => {
    const people = [{ personId: "kara", name: "Kara" }];
    expect(matchExistingPersonAnswer("that's Kara again", people)).toEqual({ personId: "kara", mode: "automatic", answer: "Kara" });
    expect(matchExistingPersonAnswer("already tagged", people)).toEqual({ personId: "kara", mode: "automatic", answer: "Kara" });
  });

  it("leaves generic same-person answers for clarification when more than one target is possible", () => {
    expect(matchExistingPersonAnswer("same person", [{ personId: "a", name: "Kara" }, { personId: "b", name: "Chloe" }]))
      .toEqual({ personId: "a", mode: "confirm", answer: "Kara" });
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
