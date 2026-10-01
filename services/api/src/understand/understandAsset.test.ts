import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
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
    embedImageContent: vi.fn().mockResolvedValue([0.75, 0.25]), commitUnderstood: vi.fn().mockResolvedValue("understood"), commitUnderstandFailed: vi.fn().mockResolvedValue("failed"), settle: vi.fn().mockResolvedValue(undefined), makeWorkDir: vi.fn().mockResolvedValue("/w"), removeWorkDir: vi.fn().mockResolvedValue(undefined), now: () => 99, ...overrides,
  };
}

describe("understandAsset", () => {
  it("logs per-stage timings for an understood photo", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let clock = 1_000;
    const deps = setup(photoAsset, {
      now: () => clock,
      objects: { download: vi.fn(), upload: vi.fn(), downloadCurrent: vi.fn(async () => { clock += 5; }) },
      analyzePhoto: vi.fn(async () => { clock += 7; return photoAnalysis; }),
      embedShots: vi.fn(async () => { clock += 11; return [{ shotId: "a1_0000", embedding: [0.1] }]; }),
      commitUnderstood: vi.fn(async () => { clock += 13; return "understood" as const; }),
    });

    try {
      await expect(understandAsset(deps, task)).resolves.toBe("understood");
      expect(info).toHaveBeenCalledWith("understand_timing", {
        queueWaitMs: 999, downloadMs: 5, analyzeMs: 7, faceEmbedMs: 0,
        shotEmbedMs: 11, commitMs: 13, totalMs: 36, faces: 0,
      });
    } finally {
      info.mockRestore();
    }
  });

  it("commits a photo analysis and a null transcript before settling", async () => {
    const deps = setup();
    await expect(understandAsset(deps, task)).resolves.toBe("understood");
    expect(deps.commitUnderstood).toHaveBeenCalledWith({ projectId: "p1", assetId: "a1", generation: "7", shots: [{ shotId: "a1_0000", analysis: photoAnalysis, embedding: [0.1] }], transcript: null, now: 99 });
    expect(deps.settle).toHaveBeenCalledWith("p1");
  });

  it("stores eligible face vectors without persisting crop files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "understand-face-crops-"));
    const jpeg = await sharp({ create: { width: 500, height: 300, channels: 3, background: "#68a5c2" } }).jpeg().toBuffer();
    const analysisWithFaces = {
      ...photoAnalysis,
      faces: [
        { faceId: "face-visible", bbox: [0.1, 0.1, 0.5, 0.5] as [number, number, number, number], confidence: 0.99, faceVisible: true },
        { faceId: "face-low-confidence", bbox: [0.2, 0.55, 0.6, 0.9] as [number, number, number, number], confidence: 0.59, faceVisible: true },
        { faceId: "face-background", bbox: [0.1, 0.5, 0.5, 0.8] as [number, number, number, number], confidence: 0.99, prominence: "background" as const, faceVisible: true },
        { faceId: "face-turned-away", bbox: [0.1, 0.6, 0.5, 0.9] as [number, number, number, number], confidence: 0.99, faceVisible: false },
        { faceId: "face-tall", bbox: [0.05, 0.05, 0.8, 0.25] as [number, number, number, number], confidence: 0.99, faceVisible: true },
        { faceId: "face-large", bbox: [0.05, 0.05, 0.8, 0.8] as [number, number, number, number], confidence: 0.99, faceVisible: true },
        { faceId: "face-tiny", bbox: [0.1, 0.1, 0.2, 0.2] as [number, number, number, number], confidence: 0.99, faceVisible: true },
      ],
    };
    let filesAtCommit: string[] = [];
    const deps = setup(photoAsset, {
      makeWorkDir: vi.fn().mockResolvedValue(dir),
      removeWorkDir: vi.fn(async (workDir) => rm(workDir, { recursive: true, force: true })),
      objects: { download: vi.fn(), upload: vi.fn(), downloadCurrent: vi.fn(async ({ destination }) => writeFile(destination, jpeg)) },
      analyzePhoto: vi.fn().mockResolvedValue(analysisWithFaces),
      embedImageContent: vi.fn().mockResolvedValue([0.75, 0.25]),
      commitUnderstood: vi.fn(async (input): Promise<"understood"> => {
        filesAtCommit = await readdir(dir);
        expect(input.shots[0]?.faceEmbeddings).toEqual({ "face-visible": [0.75, 0.25] });
        return "understood";
      }),
    });

    await expect(understandAsset(deps, task)).resolves.toBe("understood");
    expect(deps.embedImageContent).toHaveBeenCalledTimes(1);
    expect(deps.embedImageContent).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-embedding-2", jpeg: expect.any(Buffer) }));
    expect(filesAtCommit).toEqual(["render.jpg"]);
    expect(deps.objects.upload).not.toHaveBeenCalled();
  });

  it("keeps the asset understood when one face embedding fails", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "understand-face-failure-"));
    const jpeg = await sharp({ create: { width: 500, height: 300, channels: 3, background: "#68a5c2" } }).jpeg().toBuffer();
    const analysisWithFaces = {
      ...photoAnalysis,
      faces: [
        { faceId: "face-fails", bbox: [0.1, 0.1, 0.5, 0.5] as [number, number, number, number], confidence: 0.99, faceVisible: true },
        { faceId: "face-works", bbox: [0.1, 0.5, 0.5, 0.9] as [number, number, number, number], confidence: 0.99, faceVisible: true },
      ],
    };
    let embedCall = 0;
    const deps = setup(photoAsset, {
      makeWorkDir: vi.fn().mockResolvedValue(dir),
      removeWorkDir: vi.fn(async (workDir) => rm(workDir, { recursive: true, force: true })),
      objects: { download: vi.fn(), upload: vi.fn(), downloadCurrent: vi.fn(async ({ destination }) => writeFile(destination, jpeg)) },
      analyzePhoto: vi.fn().mockResolvedValue(analysisWithFaces),
      embedImageContent: vi.fn(async () => {
        embedCall += 1;
        if (embedCall === 1) throw new Error("embedding service unavailable");
        return [0.5, 0.5];
      }),
    });

    await expect(understandAsset(deps, task)).resolves.toBe("understood");
    expect(deps.commitUnderstood).toHaveBeenCalledWith(expect.objectContaining({
      shots: [expect.objectContaining({ faceEmbeddings: { "face-works": [0.5, 0.5] } })],
    }));
    expect(deps.commitUnderstandFailed).not.toHaveBeenCalled();
  });

  it("omits face embeddings when a photo has no detected faces", async () => {
    const deps = setup();
    await expect(understandAsset(deps, task)).resolves.toBe("understood");
    const commitInput = vi.mocked(deps.commitUnderstood).mock.calls[0]?.[0];
    expect(commitInput?.shots[0]).not.toHaveProperty("faceEmbeddings");
    expect(deps.embedImageContent).not.toHaveBeenCalled();
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
