import { describe, expect, it } from "vitest";
import { leaveOutShots } from "./leaveOut.js";
import type { Cast } from "./types.js";

const cast = (excluded: string[] = []): Cast => ({
  people: ["dad", "mom", "kid"].map((personId) => ({ personId, role: personId === "kid" ? "child" : "parent", ageBand: personId === "kid" ? "child" : "adult", appearances: 5, subjectCount: 5, faceIds: [], confidence: "high", excluded: excluded.includes(personId) })),
  core: ["dad", "mom", "kid"], focus: ["kid"], source: "labelled",
});
const BIG: [number, number, number, number] = [0.2, 0.3, 0.7, 0.7];
const SMALL_EDGE: [number, number, number, number] = [0.05, 0.9, 0.12, 0.97];

describe("leaveOutShots", () => {
  it("reports stored blur and duplicate results, keeping the burst primary", () => {
    expect(leaveOutShots([
      { shotId: "primary", faces: [] },
      { shotId: "blur", faces: [], blurry: true },
      { shotId: "duplicate", faces: [], dupOf: "primary" },
      { shotId: "both", faces: [], blurry: true, dupOf: "primary" },
    ], cast(), [])).toEqual([
      { shotId: "blur", reason: "Blurry photo" },
      { shotId: "duplicate", reason: "Similar photo — best one kept" },
      { shotId: "both", reason: "Blurry photo" },
    ]);
  });
  it("keeps a family photo with a background stranger", () => {
    expect(leaveOutShots([{ shotId: "s1", faces: [{ bbox: BIG, personId: "kid" }, { bbox: SMALL_EDGE, personId: null, stranger: true }] }], cast(), [])).toEqual([]);
  });
  it("leaves out a photo where a stranger is the only subject", () => {
    expect(leaveOutShots([{ shotId: "s2", faces: [{ bbox: BIG, personId: null, stranger: true }] }], cast(), []))
      .toEqual([{ shotId: "s2", reason: "Left out: someone outside the family is the main subject." }]);
  });
  it("never leaves out a photo with no faces", () => {
    expect(leaveOutShots([{ shotId: "scenery", faces: [] }], cast(), [])).toEqual([]);
  });
  it("honours a manual cast tag on a photo without detected faces", () => {
    expect(leaveOutShots([{ shotId: "manual", faces: [], manualPersonIds: ["kid"] }], cast(["kid"]), [])).toEqual([{ shotId: "manual", reason: "Left out: someone you left out is the main subject." }]);
  });
  it("leaves out an excluded person's subject photos but keeps their background ones", () => {
    const out = leaveOutShots([
      { shotId: "dadSolo", faces: [{ bbox: BIG, personId: "dad" }] },
      { shotId: "dadBehind", faces: [{ bbox: BIG, personId: "kid" }, { bbox: SMALL_EDGE, personId: "dad" }] },
    ], cast(["dad"]), []);
    expect(out.map((item) => item.shotId)).toEqual(["dadSolo"]);
  });
  it("leaves out photos the user hid", () => {
    expect(leaveOutShots([{ shotId: "h", faces: [] }], cast(), ["h"])).toEqual([{ shotId: "h", reason: "Hidden by you." }]);
  });
  it("treats a face with no confirmed person as a stranger", () => {
    const out = leaveOutShots([{ shotId: "new", faces: [{ bbox: BIG, personId: "unknown-9" }] }], { ...cast(), confirmed: true }, []);
    expect(out.map((item) => item.shotId)).toEqual(["new"]);
  });
  it("never leaves out a photo because its faces weren't recognised", () => {
    expect(leaveOutShots([{ shotId: "missed", faces: [{ bbox: BIG, personId: null }, { bbox: BIG, personId: null }] }], cast(), [])).toEqual([]);
  });
  it("leaves out a family photo when a known stranger is as prominent as the family", () => {
    expect(leaveOutShots([{ shotId: "crowded", faces: [{ bbox: BIG, personId: "kid" }, { bbox: BIG, personId: null, stranger: true }] }], cast(), []))
      .toEqual([{ shotId: "crowded", reason: "Left out: someone outside the family is as prominent as the family." }]);
  });
});
