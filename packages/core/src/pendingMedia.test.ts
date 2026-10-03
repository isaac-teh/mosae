import { afterEach, describe, expect, it } from "vitest";
import { getPendingMedia, getPendingMediaAssets, setPendingMedia, setPendingMediaRetry, retryPendingMedia } from "./pendingMedia";

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

it("retries through the upload owner only for its project", async () => {
  let calls = 0;
  setPendingMediaRetry("project-a", async () => { calls++; });
  await retryPendingMedia("project-b");
  expect(calls).toBe(0);
  await retryPendingMedia("project-a");
  expect(calls).toBe(1);
});
