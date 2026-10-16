import { describe, expect, it } from "vitest";
import { applyEdits, type EditOp } from "./edits.js";
import { planCollageGroups, planCollageMerges } from "./collageGrouping.js";
import { parseTimeline, type Timeline } from "./timeline.js";
import { collageLayoutForCount } from "./collageGeometry.js";

const cut = { kind: "cut" as const, durationSec: 0 };
const photo = (id: string, durationSec = 2, extra: object = {}) => ({ id, source: { kind: "photo" as const, shotId: `shot-${id}`, ...extra }, startSec: 0, durationSec, transitionIn: cut });
const video = (id: string) => ({ id, source: { kind: "video" as const, shotId: `shot-${id}`, sourceInSec: 0, sourceOutSec: 2 }, startSec: 0, durationSec: 2, transitionIn: cut });

function film(clips: Array<ReturnType<typeof photo> | ReturnType<typeof video>>, chapterStarts = [0], aspect: Timeline["aspect"] = "9:16"): Timeline {
  let at = 0;
  const placed = clips.map((clip) => { const next = { ...clip, startSec: at }; at += clip.durationSec; return next; });
  return parseTimeline({
    schemaVersion: 2, projectId: "p", mode: "memory", aspect, fps: 30, durationSec: at,
    chapters: chapterStarts.map((i, n) => ({ title: `Ch ${n}`, startSec: placed[i]!.startSec })),
    videoClips: placed, audioClips: [], captions: [{ text: "Hello", startSec: 0.2, endSec: 1 }],
  });
}

const merge = (...clipIds: string[]): EditOp => ({ op: "mergeIntoCollage", clipIds });

describe("mergeIntoCollage", () => {
  const base = film([photo("a"), photo("b"), photo("c"), photo("d"), photo("e")]);

  it.each([[2, "simple-stacked"], [3, "simple-three-stacked"], [4, "simple-grid-2x2"]])("uses a simple layout for %i photos", (count, layoutId) => {
    const ids = ["a", "b", "c", "d"].slice(0, count);
    const result = applyEdits(base, [merge(...ids)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const collage = result.timeline.videoClips[0]!;
    expect("kind" in collage && collage.spec.layoutId).toBe(layoutId);
    expect("kind" in collage && collage.spec.slots.map((slot) => slot.shotId).sort()).toEqual(ids.map((id) => `shot-${id}`));
    expect(result.timeline.videoClips).toHaveLength(5 - count + 1);
  });

  it.each([2, 3, 4])("uses the landscape-safe, count-matched layout for %i photos", (count) => {
    const base = film([photo("a"), photo("b"), photo("c"), photo("d")], [0], "16:9");
    const result = applyEdits(base, [merge(...["a", "b", "c", "d"].slice(0, count))]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const collage = result.timeline.videoClips[0]!;
    expect("kind" in collage && collage.spec.layoutId).toBe(collageLayoutForCount(count, "16:9"));
  });

  it("is deterministic with stable ids and a sensible duration", () => {
    const one = applyEdits(base, [merge("b", "c")]);
    const two = applyEdits(base, [merge("b", "c")]);
    expect(one).toEqual(two);
    if (!one.ok) throw new Error(one.error);
    const collage = one.timeline.videoClips[1]!;
    expect("kind" in collage && collage.clipId).toBe("merge:b");
    expect(collage.durationSec).toBe(4);
    expect(one.timeline.captions).toHaveLength(1);
  });

  it("can be undone by splitting back into photos", () => {
    const merged = applyEdits(base, [merge("a", "b", "c")]);
    if (!merged.ok) throw new Error(merged.error);
    const split = applyEdits(merged.timeline, [{ op: "splitCollage", clipId: "merge:a" }]);
    expect(split.ok && split.timeline.videoClips.map((clip) => "kind" in clip ? "collage" : clip.source.shotId)).toEqual(["shot-a", "shot-b", "shot-c", "shot-d", "shot-e"]);
  });

  it("fits mixed aspect ratios to layout cells", () => {
    const sized = film([photo("a", 2, { width: 4000, height: 3000 }), photo("b", 2, { width: 3000, height: 4000 }), photo("c")]);
    expect(applyEdits(sized, [merge("a", "b")]).ok).toBe(true);
  });

  it.each([
    ["non-adjacent clips", [merge("a", "c")], /adjacent/],
    ["out of order clips", [merge("b", "a")], /adjacent/],
    ["unknown clip", [merge("a", "zz")], /unknown clipId/],
    ["duplicate ids", [merge("a", "a")], /unique|adjacent/],
    ["a single clip", [merge("a")], /.+/],
    ["five clips", [merge("a", "b", "c", "d", "e")], /.+/],
  ])("rejects %s", (_name, ops, message) => {
    const result = applyEdits(base, ops as EditOp[]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it("rejects videos, existing collages and chapter crossings", () => {
    const withVideo = film([photo("a"), video("v"), photo("c")]);
    expect(applyEdits(withVideo, [merge("a", "v")]).ok).toBe(false);
    const merged = applyEdits(base, [merge("a", "b")]);
    if (!merged.ok) throw new Error(merged.error);
    expect(applyEdits(merged.timeline, [merge("merge:a", "c")]).ok).toBe(false);
    const chapters = film([photo("a"), photo("b"), photo("c")], [0, 2]);
    const crossing = applyEdits(chapters, [merge("b", "c")]);
    expect(crossing.ok).toBe(false);
    if (!crossing.ok) expect(crossing.error).toMatch(/chapters/);
  });
});

describe("planCollageGroups", () => {
  it("keeps the first and last moments single and groups only the middle", () => {
    const timeline = film([photo("a"), photo("b"), photo("c"), photo("d"), photo("e")]);
    expect(planCollageMerges({ timeline }, "most")).toEqual([merge("b", "c", "d")]);
  });

  it("never groups videos, collages or crosses chapters", () => {
    const timeline = film([photo("a"), photo("b"), photo("c"), video("v"), photo("d"), photo("e"), photo("f"), photo("g")], [0, 5]);
    const ops = planCollageMerges({ timeline }, "most");
    expect(ops).toEqual([merge("b", "c"), merge("e", "f")]);
    expect(applyEdits(timeline, ops).ok).toBe(true);
  });

  it("prefers neighbours who share people and caps a group at four", () => {
    const timeline = film(Array.from({ length: 8 }, (_, i) => photo(`p${i}`)));
    const people = new Map([["shot-p1", ["x"]], ["shot-p2", ["x"]], ["shot-p3", ["y"]], ["shot-p4", ["y"]], ["shot-p5", ["y"]]]);
    const groups = planCollageGroups({ timeline, peopleByShot: people });
    expect(groups.every((group) => group.clipIds.length >= 2 && group.clipIds.length <= 4)).toBe(true);
    expect(groups.map((group) => group.clipIds)).toEqual([["p1", "p2"], ["p3", "p4", "p5", "p6"]]);
  });

  it("'more' adds at most two new collages and uses the ends only as a fallback", () => {
    const long = film(Array.from({ length: 12 }, (_, i) => photo(`p${i}`)));
    expect(planCollageMerges({ timeline: long }, "more").length).toBe(2);
    expect(planCollageMerges({ timeline: film([photo("a"), photo("b")]) }, "more")).toEqual([merge("a", "b")]);
    expect(planCollageMerges({ timeline: film([photo("a")]) }, "most")).toEqual([]);
  });
});
