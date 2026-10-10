import { afterEach, describe, expect, it } from "vitest";
import { getPendingMedia, getPendingMediaAssets, getUploadRecoveryOwner, setPendingMedia, setPendingMediaRetry, retryPendingMedia, setUploadRecoveryOwner } from "./pendingMedia";
import { createUploadRecoveryOwner } from "./uploadRecovery";

afterEach(() => setPendingMedia([]));

describe("pending uploaded media", () => {
  it("keeps local files paired with their upload asset IDs for director progress", () => {
    const photo = new File(["photo"], "trip.jpg", { type: "image/jpeg" });
    const clip = new File(["clip"], "trip.mov", { type: "video/quicktime" });
    setPendingMedia([photo, clip], ["asset-photo", "asset-clip"]);
    expect(getPendingMedia()).toEqual([photo, clip]);
    expect(getPendingMediaAssets()).toEqual([
      { file: photo, assetId: "asset-photo", sessionId: null },
      { file: clip, assetId: "asset-clip", sessionId: null },
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

it("does not run another retry while a project retry is already in flight", async () => {
  let finish!: () => void;
  setPendingMediaRetry("project-a", () => new Promise<void>((resolve) => { finish = resolve; }));
  const first = retryPendingMedia("project-a");
  await Promise.resolve();
  await expect(retryPendingMedia("project-a")).resolves.toBe(false);
  finish();
  await expect(first).resolves.toBe(true);
});

it("scopes recovery owners and rejects a duplicate in-flight recovery", async () => {
  const owner = createUploadRecoveryOwner("project-a", { totalFiles: 1, uploadedFiles: 0, failedFiles: 1, bytesSent: 0, totalBytes: 10 });
  setUploadRecoveryOwner(owner);
  expect(getUploadRecoveryOwner("project-a")).toBe(owner);
  expect(getUploadRecoveryOwner("project-b")).toBeNull();
  let finish!: () => void;
  setPendingMediaRetry("project-a", () => new Promise<void>((resolve) => { finish = resolve; }));
  const running = retryPendingMedia("project-a");
  await Promise.resolve();
  expect(owner.retryInFlight).toBe(true);
  expect(await retryPendingMedia("project-a")).toBe(false);
  finish();
  await expect(running).resolves.toBe(true);
});

it("retains the retry file and aggregate logical slot after a failed replacement attempt", async () => {
  const photo = new File(["photo"], "missing.jpg", { type: "image/jpeg" });
  const owner = createUploadRecoveryOwner("project-recovery", { totalFiles: 3, uploadedFiles: 1, failedFiles: 2, bytesSent: 5, totalBytes: 30 }, [photo]);
  owner.entries[0]!.assetId = "failed-successor-1";
  owner.entries[0]!.sessionId = "session-successor-1";
  owner.entries[0]!.status = "failed";
  owner.entries[0]!.replacesAssetId = "failed-original";
  owner.entries[0]!.replacesSessionId = "session-original";
  expect(owner.entries[0]).toMatchObject({ file: photo, assetId: "failed-successor-1", sessionId: "session-successor-1", status: "failed" });
  expect(owner.aggregate).toEqual({ totalFiles: 3, uploadedFiles: 1, failedFiles: 2, bytesSent: 5, totalBytes: 30 });
});
