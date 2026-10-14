import { describe, expect, it } from "vitest";
import { boxIou, FACE_EMBEDDING_MODEL } from "./faceService.js";

describe("face service contract", () => {
  it("uses normalized box overlap to retain Gemini face metadata", () => {
    expect(boxIou([0.1, 0.1, 0.5, 0.5], [0.1, 0.1, 0.5, 0.5])).toBe(1);
    expect(boxIou([0, 0, 0.1, 0.1], [0.8, 0.8, 0.9, 0.9])).toBe(0);
  });

  it("names the stored vector model explicitly", () => {
    expect(FACE_EMBEDDING_MODEL).toBe("arcface-buffalo_l-v1");
  });
});
