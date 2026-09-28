import { describe, expect, it, vi } from "vitest";
import type { MediaFacts, QualityFacts } from "../domain/media.js";
import type { Asset } from "../store/finalizeStore.js";
import { PermanentIngestError } from "./errors.js";
import { extensionFor, ingestAsset, type IngestDeps } from "./ingestAsset.js";

const photoFacts: MediaFacts = { kind: "photo", width: 400, height: 300, durationSec: null, localTime: "2026-05-03T09:00:00", timeSource: "exif", gps: null, camera: null };
const videoFacts: MediaFacts = { kind: "video", width: 640, height: 360, durationSec: 5, localTime: null, timeSource: "none", gps: null, camera: null };
const quality: QualityFacts = { sharpness: 80, exposure: 120, blurry: false, dHash: "00ff00ff00ff00ff" };

const baseAsset: Asset = {
  id: "a1", projectId: "p1", userId: "u1", sessionId: "s1", storagePath: "uploads/u1/p1/s1/a1/original",
  generation: "7", contentType: "image/jpeg", sizeBytes: 100, fileName: "a.jpg", status: "uploaded",
  pipelineVersion: 1, failureReason: null, createdAt: 1, updatedAt: 1,
};

function setup(asset: Asset | null = baseAsset, overrides: Partial<IngestDeps> = {}) {
  const calls: string[] = [];
  const deps: IngestDeps = {
    loadAsset: vi.fn().mockResolvedValue(asset),
    objects: {
      download: vi.fn(async () => { calls.push("download"); }),
      downloadCurrent: vi.fn(),
      upload: vi.fn(async ({ path }: { path: string }) => { calls.push(`upload:${path}`); }),
    },
    probe: vi.fn().mockResolvedValue(photoFacts),
    photoDerivatives: vi.fn().mockResolvedValue({ thumb: "/w/thumb.jpg", render: "/w/render.jpg" }),
    videoDerivatives: vi.fn().mockResolvedValue({ proxy: "/w/proxy.mp4", thumb: "/w/video-thumb.jpg" }),
    analyze: vi.fn().mockResolvedValue(quality),
    detectShots: vi.fn().mockResolvedValue([{ startSec: 0, endSec: 2 }, { startSec: 2, endSec: 5 }]),
    commitIngested: vi.fn(async () => { calls.push("commit"); return "ingested" as const; }),
    commitFailed: vi.fn().mockResolvedValue("failed"),
    settle: vi.fn().mockResolvedValue(undefined),
    dispatchDue: vi.fn().mockResolvedValue(undefined),
    makeWorkDir: vi.fn().mockResolvedValue("/w"),
    removeWorkDir: vi.fn().mockResolvedValue(undefined),
    maxBytes: 1000,
    now: () => 99,
    ...overrides,
  };
  return { deps, calls };
}

const task = { projectId: "p1", assetId: "a1", generation: "7" };

describe("ingestAsset", () => {
  it("ingests a photo: uploads both derivatives before committing, then settles", async () => {
    const { deps, calls } = setup();
    expect(await ingestAsset(deps, task)).toBe("ingested");
    expect(calls).toEqual(["download", "upload:proxies/u1/p1/a1/7/thumb.jpg", "upload:proxies/u1/p1/a1/7/render.jpg", "commit"]);
    expect(deps.commitIngested).toHaveBeenCalledWith({
      projectId: "p1", assetId: "a1", generation: "7", media: photoFacts, quality,
      place: null,
      derivatives: { thumbPath: "proxies/u1/p1/a1/7/thumb.jpg", renderPath: "proxies/u1/p1/a1/7/render.jpg", proxyPath: null },
      ranges: [], now: 99,
    });
    expect(deps.analyze).toHaveBeenCalledWith("/w/thumb.jpg");
    expect(deps.detectShots).not.toHaveBeenCalled();
    expect(deps.settle).toHaveBeenCalledWith("p1");
    expect(deps.removeWorkDir).toHaveBeenCalledWith("/w");
  });

  it("stores GPS-derived places, leaves no-GPS place null, and tolerates resolver failures", async () => {
    const gpsFacts = { ...photoFacts, gps: { lat: 1.404, lng: 103.793 } };
    const place = { name: "Singapore Zoo", level: "landmark" as const };
    const withGps = setup(baseAsset, { probe: vi.fn().mockResolvedValue(gpsFacts), placeResolver: { resolve: vi.fn().mockResolvedValue(place) } });
    await ingestAsset(withGps.deps, task);
    expect(withGps.deps.commitIngested).toHaveBeenCalledWith(expect.objectContaining({ place }));
    expect(withGps.deps.placeResolver?.resolve).toHaveBeenCalledWith(gpsFacts.gps);

    const withoutGps = setup(baseAsset, { placeResolver: { resolve: vi.fn().mockRejectedValue(new Error("no geocoder")) } });
    await ingestAsset(withoutGps.deps, task);
    expect(withoutGps.deps.commitIngested).toHaveBeenCalledWith(expect.objectContaining({ place: null }));
    expect(withoutGps.deps.placeResolver?.resolve).not.toHaveBeenCalled();

    const resolverFails = setup(baseAsset, { probe: vi.fn().mockResolvedValue(gpsFacts), placeResolver: { resolve: vi.fn().mockRejectedValue(new Error("no geocoder")) } });
    await ingestAsset(resolverFails.deps, task);
    expect(resolverFails.deps.commitIngested).toHaveBeenCalledWith(expect.objectContaining({ place: null }));
    expect(resolverFails.deps.commitFailed).not.toHaveBeenCalled();
  });

  it("ingests a video: detects shots on the proxy and uploads the poster and proxy", async () => {
    const asset = { ...baseAsset, contentType: "video/mp4" };
    const { deps } = setup(asset, { probe: vi.fn().mockResolvedValue(videoFacts) });
    expect(await ingestAsset(deps, task)).toBe("ingested");
    expect(deps.videoDerivatives).toHaveBeenCalledWith("/w/original", "/w", 5);
    expect(deps.detectShots).toHaveBeenCalledWith("/w/proxy.mp4", 5);
    expect(deps.analyze).toHaveBeenCalledWith("/w/video-thumb.jpg");
    expect(deps.objects.upload).toHaveBeenCalledWith({ source: "/w/video-thumb.jpg", path: "proxies/u1/p1/a1/7/thumb.jpg", contentType: "image/jpeg" });
    expect(deps.objects.upload).toHaveBeenCalledWith({ source: "/w/proxy.mp4", path: "proxies/u1/p1/a1/7/proxy.mp4", contentType: "video/mp4" });
    expect(deps.commitIngested).toHaveBeenCalledWith(expect.objectContaining({ ranges: [{ startSec: 0, endSec: 2 }, { startSec: 2, endSec: 5 }] }));
  });

  it("skips a missing asset and a stale generation without touching storage", async () => {
    const missing = setup(null);
    expect(await ingestAsset(missing.deps, task)).toBe("skipped");
    const stale = setup({ ...baseAsset, generation: "9" });
    expect(await ingestAsset(stale.deps, task)).toBe("skipped");
    expect(stale.deps.objects.download).not.toHaveBeenCalled();
    expect(stale.deps.settle).not.toHaveBeenCalled();
  });

  it("skips an already ingested asset but still re-checks readiness, recovering a lost settle", async () => {
    const { deps } = setup({ ...baseAsset, status: "ingested" });
    expect(await ingestAsset(deps, task)).toBe("skipped");
    expect(deps.objects.download).not.toHaveBeenCalled();
    expect(deps.settle).toHaveBeenCalledWith("p1");
  });

  it("fails an oversized asset permanently without downloading it", async () => {
    const { deps } = setup({ ...baseAsset, sizeBytes: 5000 });
    expect(await ingestAsset(deps, task)).toBe("failed");
    expect(deps.objects.download).not.toHaveBeenCalled();
    expect(deps.commitFailed).toHaveBeenCalledWith({ projectId: "p1", assetId: "a1", generation: "7", reason: "too_large_for_ingest", now: 99 });
    expect(deps.settle).toHaveBeenCalledWith("p1");
  });

  it("fails the asset and still settles when the file is permanently unreadable", async () => {
    const { deps } = setup(baseAsset, { probe: vi.fn().mockRejectedValue(new PermanentIngestError("unreadable_media")) });
    expect(await ingestAsset(deps, task)).toBe("failed");
    expect(deps.commitFailed).toHaveBeenCalledWith(expect.objectContaining({ reason: "unreadable_media" }));
    expect(deps.commitIngested).not.toHaveBeenCalled();
    expect(deps.settle).toHaveBeenCalledWith("p1");
    expect(deps.removeWorkDir).toHaveBeenCalledWith("/w");
  });

  it("rethrows a transient error so the queue retries, and still cleans up", async () => {
    const { deps } = setup(baseAsset, {
      objects: { download: vi.fn().mockRejectedValue(new Error("network reset")), downloadCurrent: vi.fn(), upload: vi.fn() },
    });
    await expect(ingestAsset(deps, task)).rejects.toThrow("network reset");
    expect(deps.commitFailed).not.toHaveBeenCalled();
    expect(deps.commitIngested).not.toHaveBeenCalled();
    expect(deps.removeWorkDir).toHaveBeenCalledWith("/w");
  });

  it("fails an otherwise transient error after the fifth attempt", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = setup(baseAsset, { objects: { download: vi.fn().mockRejectedValue(new Error("network reset")), downloadCurrent: vi.fn(), upload: vi.fn() } });
    try {
      await expect(ingestAsset(deps, { ...task, attempt: 4 })).resolves.toBe("failed");
      expect(deps.commitFailed).toHaveBeenCalledWith(expect.objectContaining({ reason: "retries_exhausted" }));
      expect(deps.settle).toHaveBeenCalledWith("p1");
      expect(error).toHaveBeenCalledWith("ingest retries exhausted", "p1", "a1", expect.any(Error));
    } finally {
      error.mockRestore();
    }
  });

  it("rejects a settle failure after a successful commit on attempt zero", async () => {
    const { deps } = setup(baseAsset, { settle: vi.fn().mockRejectedValue(new Error("firestore down")) });
    await expect(ingestAsset(deps, task)).rejects.toThrow("firestore down");
  });

  it("rejects a settle failure after a successful commit on the terminal delivery", async () => {
    const { deps } = setup(baseAsset, { settle: vi.fn().mockRejectedValue(new Error("firestore down")) });
    await expect(ingestAsset(deps, { ...task, attempt: 4 })).rejects.toThrow("firestore down");
    expect(deps.commitFailed).not.toHaveBeenCalled();
  });

  it("rejects a settle failure after committing a permanent failure", async () => {
    const { deps } = setup(baseAsset, {
      probe: vi.fn().mockRejectedValue(new PermanentIngestError("unreadable_media")),
      settle: vi.fn().mockRejectedValue(new Error("firestore down")),
    });
    await expect(ingestAsset(deps, task)).rejects.toThrow("firestore down");
    expect(deps.commitFailed).toHaveBeenCalledWith(expect.objectContaining({ reason: "unreadable_media" }));
  });

  it("settles again on redelivery after a successful commit whose settle failed", async () => {
    const { deps } = setup(baseAsset, {
      loadAsset: vi.fn()
        .mockResolvedValueOnce(baseAsset)
        .mockResolvedValueOnce({ ...baseAsset, status: "ingested" }),
      settle: vi.fn()
        .mockRejectedValueOnce(new Error("firestore down"))
        .mockResolvedValueOnce(undefined),
    });
    await expect(ingestAsset(deps, { ...task, attempt: 4 })).rejects.toThrow("firestore down");
    expect(await ingestAsset(deps, task)).toBe("skipped");
    expect(deps.settle).toHaveBeenCalledTimes(2);
    expect(deps.settle).toHaveBeenLastCalledWith("p1");
  });

  it("fails redelivery when settling an already ingested asset throws", async () => {
    const { deps } = setup({ ...baseAsset, status: "ingested" }, { settle: vi.fn().mockRejectedValue(new Error("firestore down")) });
    await expect(ingestAsset(deps, task)).rejects.toThrow("firestore down");
  });

  it("does not settle when the commit lost a race and was skipped", async () => {
    const { deps } = setup(baseAsset, { commitIngested: vi.fn().mockResolvedValue("skipped") });
    expect(await ingestAsset(deps, task)).toBe("skipped");
    expect(deps.settle).not.toHaveBeenCalled();
  });
});

describe("extensionFor", () => {
  it("keeps a HEIC extension so heif-convert recognises the file, and adds none otherwise", () => {
    expect(extensionFor("image/heic")).toBe(".heic");
    expect(extensionFor("image/heif")).toBe(".heif");
    expect(extensionFor("image/jpeg")).toBe("");
    expect(extensionFor("video/quicktime")).toBe("");
  });
});
