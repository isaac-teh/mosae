import { describe, it, expect } from "vitest";
import { safeParseStoryIntent, StoryIntentSchema } from "./intent.js";

const valid = {
  schemaVersion: 1,
  id: "intent1",
  projectId: "project1",
  version: 1,
  text: "A warm birthday story centered on Mei.",
  focus: ["family", "birthday"],
};

describe("StoryIntentSchema", () => {
  it("accepts a valid story intent", () => {
    const result = safeParseStoryIntent(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.intent.focus).toEqual(["family", "birthday"]);
  });

  it("rejects empty intent text", () => {
    expect(safeParseStoryIntent({ ...valid, text: "" }).ok).toBe(false);
  });

  it("rejects a non-positive version", () => {
    expect(StoryIntentSchema.safeParse({ ...valid, version: 0 }).success).toBe(false);
  });
});
