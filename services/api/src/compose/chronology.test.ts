import { describe, expect, it } from "vitest";
import { orderByChronology, applyArc, type ClipTime } from "./chronology.js";

const c = (itemId: string) => ({ itemId });
const t = (entries: [string, number, string | null, number][]) =>
  new Map<string, ClipTime>(entries.map(([id, chapter, localTime, score]) => [id, { chapter, localTime, score }]));

describe("orderByChronology", () => {
  it("sorts by chapter, then capture time; undated keep their relative order at the end of their chapter", () => {
    const times = t([["b", 2, "2026-06-02T09:00:00", 0], ["a", 1, "2026-06-01T10:00:00", 0], ["a0", 1, "2026-06-01T08:00:00", 0], ["u", 3, null, 0]]);
    expect(orderByChronology([c("u"), c("b"), c("a"), c("a0")], times).map((x) => x.itemId)).toEqual(["a0", "a", "b", "u"]);
  });
});

describe("applyArc", () => {
  it("ends every chapter but the last on its highest-scoring clip, and says so", () => {
    const times = t([["a", 1, "2026-06-01T08:00:00", 0.9], ["b", 1, "2026-06-01T09:00:00", 0.2], ["c", 2, "2026-06-02T09:00:00", 0.5]]);
    const out = applyArc([c("a"), c("b"), c("c")], times);
    expect(out.clips.map((x) => x.itemId)).toEqual(["b", "a", "c"]);
    expect(out.reasons).toContain("Each day builds to its best moment.");
  });
  it("leaves a single-chapter film alone without a reason", () => {
    const times = t([["a", 1, "2026-06-01T08:00:00", 0.9], ["b", 1, "2026-06-01T09:00:00", 0.2]]);
    expect(applyArc([c("a"), c("b")], times)).toEqual({ clips: [c("a"), c("b")], reasons: [] });
  });
});
