import { describe, expect, it } from "vitest";
import { loadDemoBundle } from "./bundle.js";

describe("trip1-v2 demo bundle", () => {
  it("contains every analyzed photo needed for a ready project", () => {
    const bundle = loadDemoBundle();
    expect(bundle.photos).toHaveLength(15);
    expect(new Set(bundle.photos.map((photo) => photo.fileName)).size).toBe(15);
    expect(bundle.photos.every((photo) => photo.analysis.kind === "photo" && photo.media.kind === "photo")).toBe(true);
    expect(bundle.cast.people).toHaveLength(3);
    expect(bundle.photos.filter((photo) => photo.place).every((photo) => photo.place?.country === "Singapore")).toBe(true);
  });
});
