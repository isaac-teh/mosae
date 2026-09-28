import { describe, expect, it } from "vitest";
import { daySummary, dayTitles, tripDays } from "./days.js";

const s = (id: string, localTime: string | null, place: string | null) => ({ id, day: localTime?.slice(0, 10) ?? null, localTime, place });

describe("tripDays", () => {
  it("orders dates, names each by its most common place, and puts undated last", () => {
    const days = tripDays([
      s("c", "2026-06-02T10:00:00", "Siloso Beach"), s("a", "2026-06-01T09:00:00", "Singapore Zoo"),
      s("b", "2026-06-01T11:00:00", null), s("d", "2026-06-02T12:00:00", "Siloso Beach"), s("u", null, null),
    ]);
    expect(days.map((day) => [day.index, day.date, day.place, day.shotIds])).toEqual([
      [1, "2026-06-01", "Singapore Zoo", ["a", "b"]], [2, "2026-06-02", "Siloso Beach", ["c", "d"]], [3, null, null, ["u"]],
    ]);
  });
  it("splits 23:30 and 00:30 into different days", () => {
    expect(tripDays([s("late", "2026-06-01T23:30:00", null), s("early", "2026-06-02T00:30:00", null)]).map((day) => day.shotIds)).toEqual([["late"], ["early"]]);
  });
  it("has no place when no photo in the day has one", () => {
    expect(tripDays([s("a", "2026-06-03T09:00:00", null)])[0]!.place).toBeNull();
  });
});

describe("daySummary", () => {
  it("tells the planner one chapter per day in order", () => {
    const text = daySummary(tripDays([s("a", "2026-06-01T09:00:00", "Singapore Zoo"), s("u", null, null)]));
    expect(text).toContain("Day 1 · Singapore Zoo: a");
    expect(text).toContain("Undated: u");
    expect(text).toContain("one per day");
    expect(text).toContain("The undated photos form the last chapter.");
  });
});

describe("daySummary without undated photos", () => {
  it("never mentions undated photos, so the planner doesn't invent that chapter", () => {
    const text = daySummary(tripDays([{ id: "a", day: "2026-06-01", localTime: "2026-06-01T09:00:00", place: null }]));
    expect(text.toLowerCase()).not.toContain("undated");
  });
});

describe("dayTitles", () => {
  it("names each shot's day for chapter titles", () => {
    const titles = dayTitles(tripDays([
      { id: "a", day: "2026-06-01", localTime: "2026-06-01T09:00:00", place: "Siloso Beach" },
      { id: "b", day: "2026-06-02", localTime: "2026-06-02T09:00:00", place: null },
      { id: "u", day: null, localTime: null, place: null },
    ]));
    expect([...titles]).toEqual([["a", "Day 1 · Siloso Beach"], ["b", "Day 2"], ["u", "Undated"]]);
  });
});
