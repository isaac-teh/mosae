import { describe, expect, it } from "vitest";
import { allocateBudget } from "./budget.js";
import type { Candidate } from "./buildCandidates.js";

const photo = (itemId: string, chapterIndex: number): Candidate => ({ candidateId: `${itemId}#photo`, itemId, kind: "photo", chapterIndex, description: itemId });
const video = (itemId: string, chapterIndex: number, lengthSec: number, windowScore: number): Candidate => ({ candidateId: `${itemId}#video`, itemId, kind: "video", chapterIndex, description: itemId, inSec: 0, outSec: lengthSec, lengthSec, windowScore });

describe("allocateBudget", () => {
  it("keeps every video once, uses two-second silent windows when video coverage alone exceeds length, and spreads photo slots across chapters", () => {
    const candidates = [video("v1", 0, 5, .9), video("v1", 0, 5, .2), video("v2", 1, 5, .8), ...Array.from({ length: 8 }, (_, i) => photo(`p${i}`, i < 4 ? 0 : 1))];
    const result = allocateBudget(candidates, new Map(), 8, 2, new Set(["p0", "p7"]));
    expect(result.selected.filter((candidate) => candidate.kind === "video").map((candidate) => candidate.itemId)).toEqual(["v1", "v2"]);
    expect(result.selected.filter((candidate) => candidate.kind === "video").map((candidate) => candidate.lengthSec)).toEqual([2, 2]);
    expect(new Set(result.selected.filter((candidate) => candidate.kind === "photo").map((candidate) => candidate.chapterIndex))).toEqual(new Set([0, 1]));
    expect(result.leftOut.map((candidate) => candidate.itemId)).toContain("p3");
  });

  it("retains locks even when there are no slots and reports remaining photos as length overflow", () => {
    const result = allocateBudget([photo("open", 0), photo("peak", 1), photo("close", 2), photo("rest", 2)], new Map(), 0, 2.7, new Set(["open", "peak", "close"]));
    expect(result.selected.map((candidate) => candidate.itemId)).toEqual(["open", "peak", "close"]);
    expect(result.leftOut.map((candidate) => candidate.itemId)).toEqual(["rest"]);
  });

  it("counts locked photos inside the overall slot budget", () => {
    const result = allocateBudget([photo("locked", 0), photo("best", 0), photo("other", 0)], new Map([["best", 1], ["other", 0.5]]), 5.4, 2.7, new Set(["locked"]));
    expect(result.selected.map((candidate) => candidate.itemId)).toEqual(["locked", "best"]);
    expect(result.leftOut.map((candidate) => candidate.itemId)).toEqual(["other"]);
  });
});
