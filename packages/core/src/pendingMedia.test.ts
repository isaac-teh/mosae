import { afterEach, describe, expect, it } from "vitest";
import { getPendingMedia, getPendingMediaAssets, setPendingMedia } from "./pendingMedia";

afterEach(() => setPendingMedia([]));

describe("pending uploaded media", () => {
  it("keeps local files paired with their upload asset IDs for director progress", () => {
    const photo = new File(["photo"], "trip.jpg", { type: "image/jpeg" });
    const clip = new File(["clip"], "trip.mov", { type: "video/quicktime" });
    setPendingMedia([photo, clip], ["asset-photo", "asset-clip"]);
    expect(getPendingMedia()).toEqual([photo, clip]);
    expect(getPendingMediaAssets()).toEqual([
      { file: photo, assetId: "asset-photo" },
      { file: clip, assetId: "asset-clip" },
    ]);
  });
});
