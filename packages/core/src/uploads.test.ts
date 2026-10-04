import { describe, it, expect, vi } from "vitest";
import { shouldUseResumableUpload, uploadMedia, type UploadDeps, type UploadProgress } from "./uploads";

function file(name: string, size: number, type = "image/jpeg") {
  return new File([new Uint8Array(size)], name, { type });
}

function fakeDeps(options: { failPath?: string; rejectLaterEntries?: boolean; shortEntries?: boolean } = {}) {
  const calls: { path: string; body?: unknown }[] = [];
  let entryCounter = 0;
  const post = vi.fn(async (path: string, body?: unknown) => {
    calls.push({ path, body });
    if (path === "/api/projects") return { project: { id: "p1" } };
    if (path === "/api/projects/p1/upload-sessions" || path.endsWith("/entries")) {
      if (options.rejectLaterEntries && path.endsWith("/entries")) throw new Error("entry_registration_failed");
      const entries = (body as { entries: { fileName: string }[] }).entries.map((e) => {
        entryCounter += 1;
        return { assetId: `a${entryCounter}`, fileName: e.fileName, storagePath: `uploads/u/p1/s1/a${entryCounter}/original` };
      });
      const registeredEntries = options.shortEntries ? entries.slice(0, -1) : entries;
      return path.endsWith("/entries") ? { entries: registeredEntries } : { session: { id: "s1" }, entries: registeredEntries };
    }
    return {};
  }) as unknown as UploadDeps["post"];

  let inFlight = 0;
  let maxInFlight = 0;
  let putFileCalls = 0;
  const putFile: UploadDeps["putFile"] = async (storagePath, f, onBytes) => {
    putFileCalls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    if (storagePath === options.failPath) throw Object.assign(new Error("denied"), { code: "storage/unauthorized" });
    onBytes(f.size);
  };
  return { deps: { post, putFile }, calls, maxInFlight: () => maxInFlight, putFileCalls: () => putFileCalls };
}

describe("uploadMedia", () => {
  it("uses one request below 5 MB and resumable transfer at or above 5 MB", () => {
    expect(shouldUseResumableUpload(4_999_999)).toBe(false);
    expect(shouldUseResumableUpload(5_000_000)).toBe(true);
  });

  it("creates a project, registers entries, uploads, and closes the session", async () => {
    const { deps, calls } = fakeDeps();
    const progress: UploadProgress[] = [];
    const result = await uploadMedia([file("a.jpg", 10), file("b.mov", 20, "video/quicktime")], { mode: "memory", onProgress: (p) => progress.push(p) }, deps);

    expect(result).toEqual({ projectId: "p1", finished: 2, failed: 0, assetIds: ["a1", "a2"] });
    expect(calls.map((c) => c.path)).toEqual([
      "/api/projects",
      "/api/projects/p1/upload-sessions",
      "/api/projects/p1/upload-sessions/s1/close",
    ]);
    expect(calls[1].body).toEqual({
      entries: [
        { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 10 },
        { fileName: "b.mov", contentType: "video/quicktime", sizeBytes: 20 },
      ],
    });
    expect(progress.at(-1)).toEqual({ totalFiles: 2, finishedFiles: 2, failedFiles: 0, bytesSent: 30, totalBytes: 30, assetStatuses: [{ assetId: "a1", status: "uploaded" }, { assetId: "a2", status: "uploaded" }] });
    expect(progress.some((p) => p.assetStatuses?.some((asset) => asset.status === "uploading"))).toBe(true);
  });

  it("uploads small batches as the original files and reports their exact byte total", async () => {
    const originals = [file("one.jpg", 13), file("two.jpg", 27)];
    const sent: File[] = [];
    const preparation = vi.fn();
    const progress: UploadProgress[] = [];
    const { deps } = fakeDeps();
    await uploadMedia(originals, {
      mode: "memory",
      onPreparationProgress: preparation,
      onProgress: (value) => progress.push(value),
    }, { ...deps, putFile: async (_path, value, onBytes) => { sent.push(value); onBytes(value.size); } });
    expect(sent).toEqual(originals);
    expect(preparation).not.toHaveBeenCalled();
    expect(progress.at(-1)?.totalBytes).toBe(40);
    expect(progress.at(-1)?.bytesSent).toBe(40);
  });

  it("starts uploading each file before preparation has finished for the whole selection", async () => {
    const preparedCounts: number[] = [];
    const countsWhenUploadStarts: number[] = [];
    let readyAssetIds: string[] = [];
    const { deps } = fakeDeps();
    const pipelineDeps: UploadDeps = {
      ...deps,
      putFile: async (_path, _file, onBytes) => {
        countsWhenUploadStarts.push(preparedCounts.at(-1) ?? 0);
        onBytes(1);
      },
    };
    await uploadMedia(Array.from({ length: 8 }, (_, i) => file(`${i}.jpg`, 1)), {
      mode: "memory",
      onPreparationProgress: ({ preparedFiles }) => preparedCounts.push(preparedFiles),
      onReady: ({ assetIds }) => { readyAssetIds = assetIds; },
    }, pipelineDeps);

    expect(countsWhenUploadStarts.length).toBe(8);
    expect(countsWhenUploadStarts.some((count) => count < 8)).toBe(true);
    expect(Array.from(readyAssetIds)).toEqual(Array.from({ length: 8 }, (_, i) => `a${i + 1}`));
  });

  it("announces chat readiness before storage transfers finish", async () => {
    const { deps } = fakeDeps();
    let finishUpload!: () => void;
    let finished = false;
    const delayedDeps: UploadDeps = {
      ...deps,
      putFile: () => new Promise<void>((resolve) => { finishUpload = () => { finished = true; resolve(); }; }),
    };
    const onProjectReady = vi.fn();
    const onReady = vi.fn();
    const transfer = uploadMedia([file("photo.jpg", 10)], { mode: "memory", onProjectReady, onReady }, delayedDeps);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith({ projectId: "p1", assetIds: ["a1"] }));
    expect(onProjectReady).toHaveBeenCalledWith("p1");
    expect(finished).toBe(false);
    finishUpload();
    await transfer;
    expect(finished).toBe(true);
  });

  it("registers more than 500 files in batches and respects concurrency", async () => {
    const { deps, calls, maxInFlight } = fakeDeps();
    const files = Array.from({ length: 501 }, (_, i) => file(`f${i}.jpg`, 1));
    const result = await uploadMedia(files, { mode: "memory", concurrency: 3 }, deps);

    expect(result.finished).toBe(501);
    expect(calls[0].path).toBe("/api/projects");
    expect(calls[1].path).toBe("/api/projects/p1/upload-sessions");
    expect(calls.slice(2, -1).every((call) => call.path === "/api/projects/p1/upload-sessions/s1/entries")).toBe(true);
    expect(calls.slice(1, -1).every(({ body }) => (body as { entries: unknown[] }).entries.length <= 500)).toBe(true);
    expect(calls.at(-1)?.path).toBe("/api/projects/p1/upload-sessions/s1/close");
    expect(maxInFlight()).toBeLessThanOrEqual(3);
  });

  it("starts the next file as soon as any pool slot frees, without waiting for a batch", async () => {
    const starts: string[] = [];
    const resolvers = new Map<string, () => void>();
    const { deps } = fakeDeps();
    const staggered: UploadDeps = {
      ...deps,
      putFile: (path) => {
        const id = path.split("/").at(-2)!;
        starts.push(id);
        return new Promise<void>((resolve) => resolvers.set(id, resolve));
      },
    };
    const uploading = uploadMedia(Array.from({ length: 6 }, (_, i) => file(`${i}.jpg`, 1)), { mode: "memory", concurrency: 4 }, staggered);
    await vi.waitFor(() => expect(starts).toHaveLength(4));
    resolvers.get("a2")!();
    await vi.waitFor(() => expect(starts).toHaveLength(5));
    expect(starts[4]).toBe("a5");
    resolvers.get("a5")!();
    await vi.waitFor(() => expect(starts).toHaveLength(6));
    expect(starts[5]).toBe("a6");
    for (const resolve of resolvers.values()) resolve();
    await uploading;
  });

  it("reports a failed upload and continues with the rest", async () => {
    const { deps, calls } = fakeDeps({ failPath: "uploads/u/p1/s1/a1/original" });
    const result = await uploadMedia([file("a.jpg", 10), file("b.jpg", 10)], { mode: "memory" }, deps);

    expect(result).toEqual({ projectId: "p1", finished: 1, failed: 1, assetIds: ["a1", "a2"] });
    expect(calls).toContainEqual({
      path: "/api/projects/p1/upload-sessions/s1/entries/a1/outcome",
      body: { kind: "failed", reason: "storage/unauthorized" },
    });
    expect(calls.at(-1)?.path).toBe("/api/projects/p1/upload-sessions/s1/close");
  });

  it("derives an empty MIME type and excludes unknown files before registration", async () => {
    const { deps, calls } = fakeDeps();
    const result = await uploadMedia([file("a.JPG", 10, ""), file("unknown.bin", 5, "")], { mode: "memory" }, deps);
    expect(result).toEqual({ projectId: "p1", finished: 1, failed: 1, assetIds: ["a1"] });
    expect(calls[1].body).toEqual({ entries: [{ fileName: "a.JPG", contentType: "image/jpeg", sizeBytes: 10 }] });
  });

  it("closes the session when a later entry-registration batch rejects", async () => {
    const { deps, calls } = fakeDeps({ rejectLaterEntries: true });
    const files = Array.from({ length: 501 }, (_, i) => file(`f${i}.jpg`, 1));

    await expect(uploadMedia(files, { mode: "memory" }, deps)).rejects.toThrow("entry_registration_failed");

    expect(calls.at(-1)?.path).toBe("/api/projects/p1/upload-sessions/s1/close");
  });

  it("closes the session without uploading when entry registration is short", async () => {
    const { deps, calls, putFileCalls } = fakeDeps({ shortEntries: true });

    await expect(uploadMedia([file("a.jpg", 10), file("b.jpg", 10)], { mode: "memory" }, deps)).rejects.toThrow(
      "entry_registration_mismatch",
    );

    expect(putFileCalls()).toBe(0);
    expect(calls.at(-1)?.path).toBe("/api/projects/p1/upload-sessions/s1/close");
  });
});

it("reports only failed originals and provides session close recovery without reuploading", async () => {
  const { deps } = fakeDeps({ failPath: "uploads/u/p1/s1/a2/original" });
  const files = [file("good.jpg", 10), file("failed.jpg", 10)];
  const failed: File[] = [];
  let closeRetry: (() => Promise<void>) | undefined;
  let closes = 0;
  const post = deps.post;
  deps.post = async (path, body) => {
    if (path.endsWith("/close") && ++closes === 1) throw new Error("offline");
    return post(path, body);
  };
  await expect(uploadMedia(files, { mode: "memory", onFileFailed: f => failed.push(f), onCloseFailure: retry => { closeRetry = retry; } }, deps)).rejects.toThrow("offline");
  expect(failed).toEqual([files[1]]);
  expect(closeRetry).toBeTypeOf("function");
  await closeRetry!();
  expect(closes).toBe(2);
});

it("settles registered entries after registration aborts before closing", async () => {
  const { deps, calls } = fakeDeps({ rejectLaterEntries: true });
  await expect(uploadMedia(Array.from({ length: 501 }, (_, i) => file(`${i}.jpg`, 1)), { mode: "memory" }, deps)).rejects.toThrow("entry_registration_failed");
  const outcomes = calls.filter(call => call.path.endsWith("/outcome"));
  expect(outcomes).toHaveLength(3);
  expect(outcomes.every(call => (call.body as any).kind === "cancelled")).toBe(true);
  expect(calls.at(-1)?.path).toMatch(/close$/);
});
