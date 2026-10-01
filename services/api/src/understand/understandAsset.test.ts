import { describe, expect, it, vi } from "vitest";
import type { Asset } from "../store/finalizeStore.js";
import { PermanentIngestError } from "../ingest/errors.js";
import { understandAsset, type UnderstandDeps } from "./understandAsset.js";

const photoAsset: Asset = { id: "a1", projectId: "p1", userId: "u1", sessionId: "s1", storagePath: "uploads/u1/p1/s1/a1/original", generation: "7", contentType: "image/jpeg", sizeBytes: 100, fileName: "a.jpg", status: "ingested", pipelineVersion: 1, failureReason: null, createdAt: 1, updatedAt: 1, media: { kind: "photo", width: 4, height: 3, durationSec: null, localTime: null, timeSource: "none", gps: null, camera: null }, derivatives: { thumbPath: "thumb", renderPath: "render", proxyPath: null } };
const photoAnalysis = { kind: "photo" as const, caption: "beach", subjects: [], setting: "", activities: [], mood: "", shotType: "", aesthetics: 3, keyMomentScore: 3, tags: [] };
const videoShot = { kind: "video" as const, description: "child", camera: "handheld", role: "A_ROLL" as const, subjects: ["child"], emotion: "happy", quality: 3, usable: true, reason: "clear" };
const task = { projectId: "p1", assetId: "a1", generation: "7" };

function setup(asset: Asset | null = photoAsset, overrides: Partial<UnderstandDeps> = {}): UnderstandDeps {
  return {
    loadAsset: vi.fn().mockResolvedValue(asset), loadShots: vi.fn().mockResolvedValue([{ id: "a1_0000", index: 0, sourceStartSec: null, sourceEndSec: null }]),
    objects: { download: vi.fn(), downloadCurrent: vi.fn(), upload: vi.fn() },
    analyzePhoto: vi.fn().mockResolvedValue(photoAnalysis), analyzeVideo: vi.fn().mockResolvedValue({ shots: [videoShot], transcript: [{ startSec: 0, endSec: 1, text: "hi" }] }), embedShots: vi.fn().mockResolvedValue([{ shotId: "a1_0000", embedding: [0.1] }]),
    uploadVideoFile: vi.fn().mockResolvedValue({ name: "files/x", uri: "gs://x", mimeType: "video/mp4" }), deleteVideoFile: vi.fn().mockResolvedValue(undefined),
    commitUnderstood: vi.fn().mockResolvedValue("understood"), commitUnderstandFailed: vi.fn().mockResolvedValue("failed"), settle: vi.fn().mockResolvedValue(undefined), makeWorkDir: vi.fn().mockResolvedValue("/w"), removeWorkDir: vi.fn().mockResolvedValue(undefined), now: () => 99, ...overrides,
  };
}

describe("understandAsset", () => {
  it("commits a photo analysis and a null transcript before settling", async () => {
    const deps = setup();
    await expect(understandAsset(deps, task)).resolves.toBe("understood");
    expect(deps.commitUnderstood).toHaveBeenCalledWith({ projectId: "p1", assetId: "a1", generation: "7", shots: [{ shotId: "a1_0000", analysis: photoAnalysis, embedding: [0.1] }], transcript: null, now: 99 });
    expect(deps.settle).toHaveBeenCalledWith("p1");
  });

  it("always deletes a Gemini video file after an analysis failure", async () => {
    const asset = { ...photoAsset, contentType: "video/mp4", media: { ...photoAsset.media!, kind: "video" as const, durationSec: 5 }, derivatives: { thumbPath: "thumb", renderPath: null, proxyPath: "proxy" } };
    const deps = setup(asset, { analyzeVideo: vi.fn().mockRejectedValue(new Error("503 unavailable")) });
    await expect(understandAsset(deps, { ...task, attempt: 4 })).resolves.toBe("failed");
    expect(deps.deleteVideoFile).toHaveBeenCalledWith("files/x");
    expect(deps.commitUnderstandFailed).toHaveBeenCalledWith(expect.objectContaining({ reason: "retries_exhausted" }));
  });

  it("does not permanently fail a transient Gemini error before the attempt cap", async () => {
    const deps = setup(photoAsset, { analyzePhoto: vi.fn().mockRejectedValue(new Error("503 unavailable")) });
    await expect(understandAsset(deps, task)).rejects.toThrow("503 unavailable");
    expect(deps.commitUnderstandFailed).not.toHaveBeenCalled();
  });

  it("fails an invalid Gemini credential permanently instead of spending all retry attempts", async () => {
    const invalidKey = Object.assign(new Error("API key not valid"), { status: 401 });
    const deps = setup(photoAsset, { analyzePhoto: vi.fn().mockRejectedValue(invalidKey) });
    await expect(understandAsset(deps, task)).resolves.toBe("failed");
    expect(deps.commitUnderstandFailed).toHaveBeenCalledWith(expect.objectContaining({ reason: "gemini_auth_failed" }));
  });

  it("fails a shotless asset with a permanent reason", async () => {
    const deps = setup(photoAsset, { loadShots: vi.fn().mockResolvedValue([]) });
    await expect(understandAsset(deps, task)).resolves.toBe("failed");
    expect(deps.commitUnderstandFailed).toHaveBeenCalledWith(expect.objectContaining({ reason: "no_shots" }));
  });

  it("skips a stale task without reading derivatives", async () => {
    const deps = setup({ ...photoAsset, generation: "8" });
    await expect(understandAsset(deps, task)).resolves.toBe("skipped");
    expect(deps.objects.downloadCurrent).not.toHaveBeenCalled();
  });
});
