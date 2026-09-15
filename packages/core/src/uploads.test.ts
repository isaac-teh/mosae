import { describe, it, expect, vi } from "vitest";
import { uploadMedia, type UploadDeps, type UploadProgress } from "./uploads";

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
  it("creates a project, registers entries, uploads, and closes the session", async () => {
    const { deps, calls } = fakeDeps();
    const progress: UploadProgress[] = [];
    const result = await uploadMedia([file("a.jpg", 10), file("b.mov", 20, "video/quicktime")], { mode: "memory", onProgress: (p) => progress.push(p) }, deps);

    expect(result).toEqual({ projectId: "p1", finished: 2, failed: 0 });
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
    expect(progress.at(-1)).toEqual({ totalFiles: 2, finishedFiles: 2, failedFiles: 0, bytesSent: 30, totalBytes: 30 });
  });

  it("registers more than 500 files in batches and respects concurrency", async () => {
    const { deps, calls, maxInFlight } = fakeDeps();
    const files = Array.from({ length: 501 }, (_, i) => file(`f${i}.jpg`, 1));
    const result = await uploadMedia(files, { mode: "memory", concurrency: 3 }, deps);

    expect(result.finished).toBe(501);
    expect(calls.map((c) => c.path)).toEqual([
      "/api/projects",
      "/api/projects/p1/upload-sessions",
      "/api/projects/p1/upload-sessions/s1/entries",
      "/api/projects/p1/upload-sessions/s1/close",
    ]);
    expect(maxInFlight()).toBeLessThanOrEqual(3);
  });

  it("reports a failed upload and continues with the rest", async () => {
    const { deps, calls } = fakeDeps({ failPath: "uploads/u/p1/s1/a1/original" });
    const result = await uploadMedia([file("a.jpg", 10), file("b.jpg", 10)], { mode: "memory" }, deps);

    expect(result).toEqual({ projectId: "p1", finished: 1, failed: 1 });
    expect(calls).toContainEqual({
      path: "/api/projects/p1/upload-sessions/s1/entries/a1/outcome",
      body: { kind: "failed", reason: "storage/unauthorized" },
    });
    expect(calls.at(-1)?.path).toBe("/api/projects/p1/upload-sessions/s1/close");
  });

  it("derives an empty MIME type and excludes unknown files before registration", async () => {
    const { deps, calls } = fakeDeps();
    const result = await uploadMedia([file("a.JPG", 10, ""), file("unknown.bin", 5, "")], { mode: "memory" }, deps);
    expect(result).toEqual({ projectId: "p1", finished: 1, failed: 1 });
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
