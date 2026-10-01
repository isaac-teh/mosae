import { describe, expect, it } from "vitest";
import { duplicateClip } from "./duplicateClip";

describe("duplicateClip", () => {
  it("returns a pure duplicate operation targeting the selected clip", () => {
    expect(duplicateClip("clip-7")).toEqual({ op: "duplicate", clipId: "clip-7" });
  });
});
