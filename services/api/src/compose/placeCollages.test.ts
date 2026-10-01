import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ALLOWED_COMBOS, parseTimeline, safeParseTimeline, type Timeline } from "@mosae/contracts";
import { loadCollageReview, placeCollages, type CollageSource } from "./placeCollages.js";

const reviewPath = fileURLToPath(new URL("./fixtures/collage-review.json", import.meta.url));
const review = loadCollageReview(reviewPath);
const cut = { kind: "cut" as const, durationSec: 0 };

function fixture(events: string[], chapters?: number[]): { timeline: Timeline; sources: Map<string, CollageSource> } {
  const chapterStarts = [...new Set(chapters ?? events.map(() => 0))].sort((a, b) => a - b);
  const timeline = parseTimeline({
    schemaVersion: 1, projectId: "project-1", mode: "memory", aspect: "9:16", fps: 30,
    durationSec: events.length * 2,
    chapters: chapterStarts.map((chapter) => ({ title: `Chapter ${chapter}`, startSec: (chapters?.indexOf(chapter) ?? 0) * 2 })),
    videoClips: events.map((_, index) => ({
      id: `clip-${index}`, source: { kind: "photo", shotId: `shot-${index}` },
      startSec: index * 2, durationSec: 2, transitionIn: cut,
    })),
    audioClips: [], captions: [],
  });
  const sources = new Map(events.map((eventId, index) => [`clip-${index}`, {
    assetId: `asset-${index}`, eventId, chapterId: `chapter-${chapters?.[index] ?? 0}`,
    localTime: `2026-05-03T09:${String(index).padStart(2, "0")}:00`,
  }]));
  return { timeline, sources };
}

const collages = (timeline: Timeline) => timeline.videoClips.filter((clip) => "kind" in clip);

describe("placeCollages", () => {
  it.each([["travel-mosaic", 8], ["nine-photo-grid", 9]] as const)("places a full %s without dropping selected photos", (layoutId, count) => {
    const { timeline, sources } = fixture([...Array.from({ length: count }, () => "burst"), "other", "other"]);
    const result = placeCollages(timeline, sources, "sample-grid", { combos: [{ layoutId, motionId: "print-drop", verdict: "keep" }] });
    const collage = collages(result)[0];
    if (!collage || !("kind" in collage)) throw new Error("expected collage");
    expect(collage.spec.layoutId).toBe(layoutId);
    expect(collage.spec.slots).toHaveLength(count);
    expect(result.durationSec).toBe(timeline.durationSec);
    expect(safeParseTimeline(result).ok).toBe(true);
  });
  it("turns a four-photo burst into one four-slot collage", () => {
    const { timeline, sources } = fixture(["burst", "burst", "burst", "burst", "e4", "e5", "e6"]);
    const result = placeCollages(timeline, sources, "project-1:generation-1", review);
    expect(result.schemaVersion).toBe(2);
    expect(collages(result)).toHaveLength(1);
    const collage = collages(result)[0];
    if (!("kind" in collage)) throw new Error("expected collage");
    expect(collage.spec.slots.map((slot) => slot.shotId)).toEqual(["shot-0", "shot-1", "shot-2", "shot-3"]);
    expect(collage.durationSec).toBe(8);
    expect(result.durationSec).toBe(timeline.durationSec);
    expect(safeParseTimeline(result).ok).toBe(true);
  });

  it("composes a burst with no capture time and omits the caption date key", () => {
    const { timeline, sources } = fixture(["burst", "burst", "burst", "burst", "e4", "e5", "e6"]);
    for (const [id, source] of sources) sources.set(id, { ...source, localTime: null });
    const result = placeCollages(timeline, sources, "project-no-date", review);
    const collage = collages(result)[0];
    if (!collage || !("kind" in collage)) throw new Error("expected collage");
    expect(Object.hasOwn(collage.spec.caption!, "date")).toBe(false);
    expect(safeParseTimeline(result).ok).toBe(true);
  });

  it("leaves a film with no bursts or same-event runs uncollaged", () => {
    const { timeline, sources } = fixture(["e0", "e1", "e2", "e3", "e4", "e5", "e6"]);
    const result = placeCollages(timeline, sources, "project-1:generation-1", review);
    expect(result.schemaVersion).toBe(2);
    expect(collages(result)).toHaveLength(0);
    expect(result.videoClips).toHaveLength(7);
  });

  it("finds a normal trip collage from fifteen photos across three days when few is selected", () => {
    const events = Array.from({ length: 15 }, () => "different-event");
    const { timeline, sources } = fixture(events);
    for (let index = 0; index < 15; index++) sources.set(`clip-${index}`, {
      ...sources.get(`clip-${index}`)!, eventId: `event-${index}`,
      localTime: `2026-06-${String(Math.floor(index / 5) + 1).padStart(2, "0")}T09:${String(index % 5).padStart(2, "0")}:00`,
    });
    const result = placeCollages(timeline, sources, "trip:few", review, { collageAmount: "few", motionFeel: "calm" });
    expect(collages(result).length).toBeGreaterThanOrEqual(1);
    expect(collages(result).length).toBeLessThanOrEqual(1);
  });

  it("omits collages when the direction says none", () => {
    const { timeline, sources } = fixture(["burst", "burst", "burst", "burst", "x", "y"]);
    expect(collages(placeCollages(timeline, sources, "trip:none", review, { collageAmount: "none", motionFeel: "calm" }))).toHaveLength(0);
  });

  it("makes lots produce more collages than few on a three-day, fifteen-photo trip", () => {
    const events = Array.from({ length: 15 }, () => "different-event");
    const { timeline, sources } = fixture(events);
    for (let index = 0; index < 15; index++) sources.set(`clip-${index}`, {
      ...sources.get(`clip-${index}`)!, eventId: `event-${index}`,
      localTime: `2026-06-${String(Math.floor(index / 5) + 1).padStart(2, "0")}T09:${String(index % 5).padStart(2, "0")}:00`,
    });
    const few = placeCollages(timeline, sources, "trip:few", review, { collageAmount: "few", motionFeel: "calm" });
    const lots = placeCollages(timeline, sources, "trip:lots", review, { collageAmount: "lots", motionFeel: "calm" });
    expect(collages(lots).length).toBeGreaterThan(collages(few).length);
    expect(collages(lots).length / lots.videoClips.length).toBeLessThanOrEqual(0.4);
  });

  it.each([
    ["calm", ["page-turn", "print-drop", "focus-relay"]],
    ["playful", ["stack-deal", "tape-slap", "crash-zoom"]],
  ] as const)("prefers %s motion for collage placement", (motionFeel, preferred) => {
    const { timeline, sources } = fixture(["burst", "burst", "burst", "burst", "x", "y"]);
    const allKept = { combos: ALLOWED_COMBOS.map((combo) => ({ ...combo, verdict: "keep" })) };
    const result = placeCollages(timeline, sources, "trip:motion", allKept, { collageAmount: "few", motionFeel });
    const collage = collages(result)[0];
    if (!(collage && "kind" in collage)) throw new Error("expected collage");
    expect(preferred).toContain(collage.spec.motionId);
  });

  it("caps lots collages at forty percent of final visual clips and two per chapter", () => {
    const events = ["a", "a", "a", "a", "b", "b", "b", "b", "c", "c", "c", "c", "x", "y", "z"];
    const chapters = events.map((_, index) => Math.floor(index / 4));
    const { timeline, sources } = fixture(events, chapters);
    const result = placeCollages(timeline, sources, "project-1:generation-1", review, { collageAmount: "lots" });
    expect(collages(result)).toHaveLength(2);
    expect(collages(result).length / result.videoClips.length).toBeLessThanOrEqual(0.4);
    expect(new Set(collages(result).map((clip) => "kind" in clip ? clip.chapterId : "" )).size).toBe(collages(result).length);
  });

  it("is deterministic for the same generation seed", () => {
    const { timeline, sources } = fixture(["burst", "burst", "burst", "burst", "e4", "e5", "e6"]);
    expect(placeCollages(timeline, sources, "project-1:generation-1", review)).toEqual(placeCollages(timeline, sources, "project-1:generation-1", review));
  });

  it("uses near-duplicate hashes from a ten-second burst across event labels", () => {
    const { timeline, sources } = fixture(["e0", "e1", "e2", "e3", "e4", "e5", "e6"]);
    for (let index = 0; index < 4; index++) sources.set(`clip-${index}`, {
      ...sources.get(`clip-${index}`)!, dHash: "0000000000000000",
      localTime: `2026-05-03T09:00:${String(index * 3).padStart(2, "0")}`,
    });
    expect(collages(placeCollages(timeline, sources, "project-1:generation-1", review))).toHaveLength(1);
  });

  it("uses ingest duplicate groups and allows only one video cell", () => {
    const { timeline, sources } = fixture(["e0", "e1", "e2", "e3", "e4", "e5", "e6"]);
    for (let index = 0; index < 4; index++) sources.set(`clip-${index}`, {
      ...sources.get(`clip-${index}`)!, assetId: `asset-${index}`,
      dupOf: index === 0 ? null : "asset-0",
    });
    const videoTimeline = parseTimeline({
      ...timeline,
      videoClips: timeline.videoClips.map((clip, index) => index === 1
        ? { ...clip, source: { kind: "video", shotId: "shot-1", sourceInSec: 0, sourceOutSec: 2 } }
        : clip),
    });
    const result = placeCollages(videoTimeline, sources, "project-1:generation-1", review);
    const collage = collages(result)[0];
    if (!("kind" in collage)) throw new Error("expected collage");
    expect(collage.spec.slots.filter((slot) => slot.kind === "video")).toHaveLength(1);
  });

  it("varies layouts across consecutive collages when two kept layouts fit", () => {
    const events = ["a", "a", "a", "a", "b", "b", "b", "b", "x", "y", "z", "u", "v", "w"];
    const chapters = events.map((_, index) => index < 4 ? 0 : index < 8 ? 1 : 2);
    const { timeline, sources } = fixture(events, chapters);
    const result = placeCollages(timeline, sources, "project-1:generation-1", {
      combos: [
        { layoutId: "torn-paper", motionId: "print-drop", verdict: "keep" },
        { layoutId: "polaroid-garland", motionId: "page-turn", verdict: "keep" },
      ],
    });
    expect(collages(result)).toHaveLength(2);
    expect(collages(result).map((clip) => "kind" in clip ? clip.spec.layoutId : "")).toHaveLength(2);
    expect(new Set(collages(result).map((clip) => "kind" in clip ? clip.spec.layoutId : "")).size).toBe(2);
  });

  it("uses only kept combinations from a fixture review file", () => {
    const { timeline, sources } = fixture(["burst", "burst", "burst", "burst", "e4", "e5", "e6"]);
    const result = placeCollages(timeline, sources, "project-1:generation-1", review);
    const collage = collages(result)[0];
    if (!("kind" in collage)) throw new Error("expected collage");
    expect([collage.spec.layoutId, collage.spec.motionId]).toEqual(["torn-paper", "print-drop"]);
  });

  it("falls back to reviewed combinations and warns if the review file is missing", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fallback = loadCollageReview(`${reviewPath}.missing`);
    expect(fallback.combos).toEqual(ALLOWED_COMBOS.map((combo) => ({ ...combo, verdict: "keep" })));
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("using reviewed combinations"),
      expect.any(Error),
    );
    warning.mockRestore();
  });

  it("reads the committed review fixture", () => {
    expect(JSON.parse(readFileSync(reviewPath, "utf8")).combos).toHaveLength(3);
  });
});
