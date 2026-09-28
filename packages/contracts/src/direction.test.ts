import { describe, it, expect } from "vitest";
import { CADENCES, DURATION_SECONDS, safeParseDirectionSettings, recommendDuration } from "./direction.js";

const valid = {
  schemaVersion: 1,
  id: "settings1",
  projectId: "project1",
  version: 1,
  note: "Keep it tender and let the birthday breathe.",
  cadenceId: "tender",
  soundtrackId: "market-theme",
  durationId: "1m",
  aspect: "9:16",
  captions: false,
};

describe("DirectionSettingsSchema", () => {
  it("accepts settings the Direct Your Film screen can produce", () => {
    const result = safeParseDirectionSettings(valid);
    expect(result.ok).toBe(true);
  });

  it("accepts an automatic soundtrack and an empty note", () => {
    expect(safeParseDirectionSettings({ ...valid, soundtrackId: null, note: "" }).ok).toBe(true);
  });

  it("rejects a cadence that is not in the catalog", () => {
    expect(safeParseDirectionSettings({ ...valid, cadenceId: "frantic" }).ok).toBe(false);
  });

  it("rejects a duration outside the supported choices", () => {
    expect(safeParseDirectionSettings({ ...valid, durationId: "10m" }).ok).toBe(false);
  });

  it("rejects an unsupported aspect ratio", () => {
    expect(safeParseDirectionSettings({ ...valid, aspect: "4:3" }).ok).toBe(false);
  });

  it("maps every duration choice to seconds within the memory film limits", () => {
    for (const id of Object.keys(DURATION_SECONDS) as (keyof typeof DURATION_SECONDS)[]) {
      expect(DURATION_SECONDS[id]).toBeGreaterThanOrEqual(30);
      expect(DURATION_SECONDS[id]).toBeLessThanOrEqual(300);
    }
  });

  it("supports the four-minute duration offered by the director chat", () => {
    expect(DURATION_SECONDS["4m"]).toBe(240);
    expect(safeParseDirectionSettings({ ...valid, durationId: "4m" }).ok).toBe(true);
  });

  it("publishes a cadence catalog the client can render", () => {
    expect(CADENCES.map((cadence) => cadence.id)).toContain("tender");
    for (const cadence of CADENCES) expect(cadence.description.length).toBeGreaterThan(0);
  });
});

describe("recommendDuration", () => {
  it.each([[0, "30s"], [5, "30s"], [12, "30s"], [20, "1m"], [45, "2m"], [70, "3m"], [200, "5m"]])(
    "%i usable photos → %s", (count, expected) => expect(recommendDuration(count)).toBe(expected));
});
