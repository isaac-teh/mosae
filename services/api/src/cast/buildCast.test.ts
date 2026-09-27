import { describe, expect, it } from "vitest";
import { buildCast } from "./buildCast.js";
import { castSummary } from "./castSummary.js";
import type { AgeBand, FaceRef, Interaction } from "./types.js";

const f = (
  faceId: string,
  shotId: string,
  ageBand?: AgeBand,
  prominence: "primary" | "secondary" | "background" = "primary",
): FaceRef => ({
  faceId,
  shotId,
  photoHash: `hash-${shotId}`,
  bbox: [0.1, 0.1, 0.3, 0.3],
  ageBand,
  prominence,
});

describe("buildCast and castSummary", () => {
  it("1. trip1 shape: adults A and B plus child C", () => {
    // 12 shots: s1..s12
    // A and B and C each in 8 shots, together in 5 (s1..s5)
    // A in s1..s8, B in s1..s8, C in s1..s5, s9..s11
    const faces: FaceRef[] = [];
    const identities = new Map<string, string>();

    let fid = 0;
    const addFace = (shotId: string, personId: string, ageBand: AgeBand) => {
      const faceId = `f${++fid}`;
      faces.push(f(faceId, shotId, ageBand, "primary"));
      identities.set(faceId, personId);
    };

    // Shots 1..5: A, B, C together (5 shots)
    for (let i = 1; i <= 5; i++) {
      addFace(`s${i}`, "A", "adult");
      addFace(`s${i}`, "B", "adult");
      addFace(`s${i}`, "C", "child");
    }
    // Shots 6..8: A, B (3 shots -> total 8 for A, 8 for B)
    for (let i = 6; i <= 8; i++) {
      addFace(`s${i}`, "A", "adult");
      addFace(`s${i}`, "B", "adult");
    }
    // Shots 9..11: C (3 shots -> total 8 for C)
    for (let i = 9; i <= 11; i++) {
      addFace(`s${i}`, "C", "child");
    }
    // Shot 12: landscape / no faces

    const cast = buildCast({
      faces,
      identities,
      interactions: [],
      source: "labelled",
    });

    expect(cast.core).toEqual(expect.arrayContaining(["A", "B", "C"]));
    expect(cast.core).toHaveLength(3);

    const personA = cast.people.find((p) => p.personId === "A");
    const personB = cast.people.find((p) => p.personId === "B");
    const personC = cast.people.find((p) => p.personId === "C");

    expect(personA?.role).toBe("parent");
    expect(personB?.role).toBe("parent");
    expect(personC?.role).toBe("child");
    expect(cast.focus).toEqual(["C"]);

    const summary = castSummary(cast, faces, identities);
    expect(summary).toBeDefined();
    expect(summary).toContain("2 parents, 1 children");
    expect(summary).toContain("in 5 photos");
  });

  it("2. Stranger: D appears once, in the background -> absent from people", () => {
    const faces = [f("f1", "s1", "adult", "background")];
    const identities = new Map([["f1", "D"]]);

    const cast = buildCast({
      faces,
      identities,
      interactions: [],
      source: "labelled",
    });

    expect(cast.people.find((p) => p.personId === "D")).toBeUndefined();
    expect(cast.people).toHaveLength(0);
  });

  it("3. Rare person: E appears in 1 of 12 shots with primary prominence -> role 'other', not core", () => {
    const faces: FaceRef[] = [];
    const identities = new Map<string, string>();

    // Seed 12 shots with core people A and B so peopleShots.size = 12
    for (let i = 1; i <= 12; i++) {
      const fA = `fA_${i}`;
      const fB = `fB_${i}`;
      faces.push(f(fA, `s${i}`, "adult"));
      faces.push(f(fB, `s${i}`, "adult"));
      identities.set(fA, "A");
      identities.set(fB, "B");
    }

    // E appears only in s1
    faces.push(f("fE", "s1", "adult", "primary"));
    identities.set("fE", "E");

    const cast = buildCast({
      faces,
      identities,
      interactions: [],
      source: "labelled",
    });

    const personE = cast.people.find((p) => p.personId === "E");
    expect(personE).toBeDefined();
    expect(personE?.role).toBe("other");
    expect(cast.core).not.toContain("E");
  });

  it("4. No people (Review Focus #1)", () => {
    const cast = buildCast({
      faces: [],
      identities: new Map(),
      interactions: [],
      source: "none",
    });

    expect(cast).toEqual({
      people: [],
      core: [],
      focus: [],
      source: "none",
    });

    expect(castSummary(cast, [], new Map())).toBeNull();
  });

  it("5. Adults only: A and B -> focus [A, B]", () => {
    const faces = [
      f("f1", "s1", "adult"),
      f("f2", "s1", "senior"),
      f("f3", "s2", "adult"),
      f("f4", "s2", "senior"),
    ];
    const identities = new Map([
      ["f1", "A"],
      ["f2", "B"],
      ["f3", "A"],
      ["f4", "B"],
    ]);

    const cast = buildCast({
      faces,
      identities,
      interactions: [],
      source: "labelled",
    });

    expect(cast.core).toEqual(expect.arrayContaining(["A", "B"]));
    expect(cast.focus).toEqual(expect.arrayContaining(["A", "B"]));
    expect(cast.focus).toHaveLength(2);

    const summary = castSummary(cast, faces, identities);
    expect(summary).toContain("focus: the family");
  });

  it("6. Split vote plus a carrying interaction: raises A to 'high'", () => {
    // Person A has 5 faces across 5 shots: 3 'adult', 2 'child' -> winning vote is adult with 3/5 = 60% (<= 60% is low)
    // Person C is a core child in 5 shots
    const faces: FaceRef[] = [
      f("fA1", "s1", "adult"),
      f("fA2", "s2", "adult"),
      f("fA3", "s3", "adult"),
      f("fA4", "s4", "child"),
      f("fA5", "s5", "child"),
      f("fC1", "s1", "child"),
      f("fC2", "s2", "child"),
      f("fC3", "s3", "child"),
      f("fC4", "s4", "child"),
      f("fC5", "s5", "child"),
    ];
    const identities = new Map([
      ["fA1", "A"],
      ["fA2", "A"],
      ["fA3", "A"],
      ["fA4", "A"],
      ["fA5", "A"],
      ["fC1", "C"],
      ["fC2", "C"],
      ["fC3", "C"],
      ["fC4", "C"],
      ["fC5", "C"],
    ]);

    // Without interaction: A has confidence 'low' due to split vote (60%)
    const castWithout = buildCast({
      faces,
      identities,
      interactions: [],
      source: "labelled",
    });
    expect(castWithout.people.find((p) => p.personId === "A")?.confidence).toBe("low");

    // With carrying interaction between A and C
    const interactions: Interaction[] = [
      { from: "fA1", to: "fC1", kind: "carrying" },
    ];

    const castWith = buildCast({
      faces,
      identities,
      interactions,
      source: "labelled",
    });
    expect(castWith.people.find((p) => p.personId === "A")?.confidence).toBe("high");
  });

  it("handles single core candidate", () => {
    const faces = [
      f("f1", "s1", "child"),
      f("f2", "s2", "child"),
    ];
    const identities = new Map([
      ["f1", "Solo"],
      ["f2", "Solo"],
    ]);

    const cast = buildCast({
      faces,
      identities,
      interactions: [],
      source: "labelled",
    });

    expect(cast.core).toEqual(["Solo"]);
    expect(cast.focus).toEqual(["Solo"]);
    expect(cast.people.find((p) => p.personId === "Solo")?.role).toBe("child");
  });

  it("breaks ageBand ties towards older band", () => {
    // 1 teen, 1 senior
    const faces = [
      f("f1", "s1", "teen"),
      f("f2", "s2", "senior"),
      f("f3", "s1", "adult"),
      f("f4", "s2", "adult"),
    ];
    const identities = new Map([
      ["f1", "X"],
      ["f2", "X"],
      ["f3", "Y"],
      ["f4", "Y"],
    ]);

    const cast = buildCast({
      faces,
      identities,
      interactions: [],
      source: "labelled",
    });

    // X has 1 teen, 1 senior -> senior wins (older)
    const personX = cast.people.find((p) => p.personId === "X");
    expect(personX?.ageBand).toBe("senior");
    expect(personX?.role).toBe("parent");
  });

  it("defaults to adult when no ageBand is defined", () => {
    const faces = [
      f("f1", "s1", undefined),
      f("f2", "s2", undefined),
    ];
    const identities = new Map([
      ["f1", "Anon"],
      ["f2", "Anon"],
    ]);

    const cast = buildCast({
      faces,
      identities,
      interactions: [],
      source: "labelled",
    });

    const person = cast.people.find((p) => p.personId === "Anon");
    expect(person?.ageBand).toBe("adult");
    expect(person?.confidence).toBe("low");
  });

  it("excludes candidate who shares no shot with any other candidate", () => {
    // A and B share s1, s2
    // C is in s3, s4 (no overlap with A or B)
    const faces = [
      f("fA1", "s1", "adult"),
      f("fA2", "s2", "adult"),
      f("fB1", "s1", "adult"),
      f("fB2", "s2", "adult"),
      f("fC1", "s3", "adult"),
      f("fC2", "s4", "adult"),
    ];
    const identities = new Map([
      ["fA1", "A"],
      ["fA2", "A"],
      ["fB1", "B"],
      ["fB2", "B"],
      ["fC1", "C"],
      ["fC2", "C"],
    ]);

    const cast = buildCast({
      faces,
      identities,
      interactions: [],
      source: "labelled",
    });

    expect(cast.core).toContain("A");
    expect(cast.core).toContain("B");
    expect(cast.core).not.toContain("C");
    expect(cast.people.find((p) => p.personId === "C")?.role).toBe("other");
  });
});
