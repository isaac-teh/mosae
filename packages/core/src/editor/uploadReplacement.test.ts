import { describe, expect, it, vi } from "vitest";
import { createReplacementGuard, uploadReplacement } from "./uploadReplacement";

describe("createReplacementGuard", () => {
  it("rejects a pending completion after the picker closes or target changes", () => {
    const guard = createReplacementGuard();
    const pendingUpload = guard.begin();
    expect(guard.isCurrent(pendingUpload)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(pendingUpload)).toBe(false);
    const nextTargetUpload = guard.begin();
    expect(guard.isCurrent(nextTargetUpload)).toBe(true);
  });
});

describe("uploadReplacement", () => {
  it("uploads into the existing project and returns the server-resolved shot", async () => {
    const media = { shotId: "asset-photo-1_0000", kind: "photo" as const, thumbnailUrl: "thumb.jpg", previewUrl: "preview.jpg", date: "2026-10-02", eventLabel: "Today" };
    const post = vi.fn(async (path: string) => {
      if (path === "/api/projects/p1/upload-sessions") return { session: { id: "session-1" }, entries: [{ assetId: "asset-photo-1", storagePath: "uploads/photo.jpg" }] };
      return {};
    });
    const getFilmTimeline = vi.fn()
      .mockResolvedValueOnce({ timeline: {}, sources: {}, unusedMedia: [] })
      .mockResolvedValueOnce({ timeline: {}, sources: {}, unusedMedia: [media] });
    const result = await uploadReplacement(new File(["photo"], "photo.jpg", { type: "image/jpeg" }), {
      projectId: "p1", generationId: "g1", repository: { getFilmTimeline } as never, pollIntervalMs: 1,
    }, { post: post as never, putFile: vi.fn(async () => undefined) }, { wait: async () => undefined });

    expect(result).toEqual(media);
    expect(post).toHaveBeenCalledWith("/api/projects/p1/upload-sessions", { entries: [{ fileName: "photo.jpg", contentType: "image/jpeg", sizeBytes: 5 }] });
    expect(post).toHaveBeenCalledWith("/api/projects/p1/upload-sessions/session-1/close");
    expect(getFilmTimeline).toHaveBeenCalledTimes(2);
  });

  it("does not invent a shot id when server processing has not created one", async () => {
    const getFilmTimeline = vi.fn(async () => ({ timeline: {}, sources: {}, unusedMedia: [] }));
    await expect(uploadReplacement(new File(["photo"], "photo.jpg", { type: "image/jpeg" }), {
      projectId: "p1", generationId: "g1", repository: { getFilmTimeline } as never, timeoutMs: 0,
    }, {
      post: vi.fn(async () => ({ session: { id: "session-1" }, entries: [{ assetId: "asset-photo-1", storagePath: "uploads/photo.jpg" }] })) as never,
      putFile: vi.fn(async () => undefined),
    })).rejects.toThrow("replacement_media_not_ready");
  });
});
