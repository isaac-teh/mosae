import { describe, expect, it } from "vitest";
import { summarise, type SummaryAsset } from "./summary.js";

const asset = (kind: "photo" | "video", localTime: string | null, place?: string): SummaryAsset => ({
  media: { kind, localTime }, place: place ? { name: place, country: "Japan" } : null,
  status: "understood", hasFaces: kind === "photo",
});

describe("summarise", () => {
  it("counts media, distinct days and places in capture order", () => {
    const result = summarise([
      asset("photo", "2026-10-20T10:00:00", "Tokyo"), asset("photo", "2026-10-20T12:00:00", "Tokyo"),
      asset("photo", "2026-10-21T10:00:00", "Kyoto"), asset("video", "2026-10-21T11:00:00", "Kyoto"),
    ], false);
    expect(result).toMatchObject({ total: 4, photos: 3, clips: 1, days: 2, places: ["Tokyo", "Kyoto"], country: "Japan", ready: { summary: true, faces: true, plan: false } });
  });
  it("counts undated assets but excludes them from days", () => {
    expect(summarise([asset("photo", null)], false)).toMatchObject({ total: 1, days: 0, dateRange: null });
  });
  it("is not ready while an asset is still ingesting", () => {
    expect(summarise([{ ...asset("photo", null), status: "uploaded", hasFaces: false }], false)).toMatchObject({ ready: { summary: false, faces: false } });
  });
  it.each([[1, "early"], [10, "early"], [11, "mid"], [19, "mid"], [20, "late"], [31, "late"]])("labels October day %i as %s October", (day, part) => {
    const summary = summarise([asset("photo", `2026-10-${String(day).padStart(2, "0")}T10:00:00`)], false);
    expect(summary.season).toBe(`${part} October`);
  });
});
