import { describe, expect, it } from "vitest";
import { analysisSearchText, type PhotoAnalysis } from "./understanding.js";

const photo: PhotoAnalysis = { kind: "photo", caption: "A beach walk", subjects: [], setting: "beach", activities: ["walking"], mood: "calm", shotType: "wide", aesthetics: 4, keyMomentScore: 4, tags: ["sunset"] };

describe("analysisSearchText", () => {
  it("joins only non-empty descriptive fields", () => {
    expect(analysisSearchText(photo)).toBe("A beach walk. beach. calm. walking. sunset");
    expect(analysisSearchText({ ...photo, caption: "", setting: "", mood: "", activities: [], tags: [] })).toBe("");
  });
});
