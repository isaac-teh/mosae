import { describe, expect, it } from "vitest";
import { clusterByTime, EVENT_GAP_MS, partOfDay, type Datable } from "./timeClusters.js";

const at = (id: string, localTime: string | null, createdAt = 0): Datable => ({ id, localTime, createdAt });

describe("partOfDay", () => {
  it("maps hours to the four parts of the day", () => {
    expect(partOfDay(4)).toBe("night");
    expect(partOfDay(5)).toBe("morning");
    expect(partOfDay(11)).toBe("morning");
    expect(partOfDay(12)).toBe("afternoon");
    expect(partOfDay(16)).toBe("afternoon");
    expect(partOfDay(17)).toBe("evening");
    expect(partOfDay(20)).toBe("evening");
    expect(partOfDay(21)).toBe("night");
  });
});

describe("clusterByTime", () => {
  it("keeps media taken close together in one event", () => {
    const events = clusterByTime([at("a", "2026-05-03T09:00:00"), at("b", "2026-05-03T09:40:00"), at("c", "2026-05-03T10:30:00")]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "e001", dayIndex: 1, date: "2026-05-03", part: "morning", label: "Day 1, morning", assetIds: ["a", "b", "c"] });
  });

  it("splits a day into events at a gap of more than three hours", () => {
    const events = clusterByTime([at("a", "2026-05-03T09:00:00"), at("b", "2026-05-03T09:20:00"), at("c", "2026-05-03T18:00:00")]);
    expect(events.map((e) => e.assetIds)).toEqual([["a", "b"], ["c"]]);
    expect(events.map((e) => e.dayIndex)).toEqual([1, 1]);
    expect(events[1].part).toBe("evening");
  });

  it("does not split at exactly three hours", () => {
    const start = Date.parse("2026-05-03T09:00:00Z");
    const later = new Date(start + EVENT_GAP_MS).toISOString().slice(0, 19);
    expect(clusterByTime([at("a", "2026-05-03T09:00:00"), at("b", later)])).toHaveLength(1);
  });

  it("starts a new event at midnight even when the gap is small", () => {
    const events = clusterByTime([at("a", "2026-05-03T23:50:00"), at("b", "2026-05-04T00:10:00")]);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.dayIndex)).toEqual([1, 2]);
  });

  it("numbers days by date order, skipping calendar days with no media", () => {
    const events = clusterByTime([at("a", "2026-05-06T09:00:00"), at("b", "2026-05-03T09:00:00")]);
    expect(events.map((e) => [e.date, e.dayIndex])).toEqual([["2026-05-03", 1], ["2026-05-06", 2]]);
  });

  it("is independent of input order and gives sequential chronological ids", () => {
    const events = clusterByTime([at("c", "2026-05-03T18:00:00"), at("a", "2026-05-03T09:00:00"), at("b", "2026-05-03T09:10:00")]);
    expect(events.map((e) => e.id)).toEqual(["e001", "e002"]);
    expect(events[0].assetIds).toEqual(["a", "b"]);
  });

  it("puts media with no capture time into one undated event after the dated ones, in upload order", () => {
    const events = clusterByTime([at("late", null, 30), at("dated", "2026-05-03T09:00:00"), at("early", null, 10)]);
    expect(events.map((e) => e.id)).toEqual(["e001", "undated"]);
    expect(events[1]).toMatchObject({ dayIndex: 0, date: null, part: "undated", label: "Undated", startLocal: null, assetIds: ["early", "late"] });
  });

  it("treats an unparseable capture time as undated instead of throwing", () => {
    const events = clusterByTime([at("bad", "not a date", 1), at("ok", "2026-05-03T09:00:00")]);
    expect(events.map((e) => e.id)).toEqual(["e001", "undated"]);
  });

  it("returns nothing for no media, and a lone undated event when nothing is dated", () => {
    expect(clusterByTime([])).toEqual([]);
    expect(clusterByTime([at("a", null)]).map((e) => e.id)).toEqual(["undated"]);
  });
});
