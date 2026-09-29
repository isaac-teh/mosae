import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { executeQueuedRender, renderRoute, type RenderCallbackPayload } from "./renderRoute.js";
import { createBundleOnce } from "./renderTimeline.js";
import { fixtureSources, fixtureTimeline } from "@mosae/video/fixture";

/**
 * The path the service actually runs. Before this, `index.ts` inlined the
 * render and `renderTimeline`'s four tests exercised a function nothing called.
 */
function app(overrides: Record<string, unknown> = {}) {
  const deps = {
    bundle: vi.fn().mockResolvedValue("http://bundle"),
    selectComposition: vi.fn().mockResolvedValue({ id: "MosaeTimeline", durationInFrames: 180 }),
    renderMedia: vi.fn().mockResolvedValue(undefined),
    outputDir: "/tmp/renders",
    mediaBaseUrl: "http://127.0.0.1:8080",
    ...overrides,
  };
  const server = express();
  server.use(express.json());
  server.post("/tasks/render", renderRoute(deps as never));
  return { server, deps };
}

const body = { timeline: fixtureTimeline, sources: fixtureSources, outputFile: "out.mp4" };

describe("executeQueuedRender", () => {
  it("reports progress and completion without calling back through the API request path", async () => {
    const callback = vi.fn(async (_event: RenderCallbackPayload) => {});
    const renderMedia = vi.fn(async (args: Record<string, unknown>) => {
      (args.onProgress as ((value: { progress: number }) => void) | undefined)?.({ progress: 0.5 });
    });
    const result = await executeQueuedRender({
      ...body,
      job: { projectId: "p1", generationId: "g1", userId: "owner", outputPath: "renders/owner/p1/g1.mp4" },
    }, {
      bundle: vi.fn().mockResolvedValue("bundle"),
      selectComposition: vi.fn().mockResolvedValue({ durationInFrames: 180 }),
      renderMedia,
      outputDir: "/tmp/renders",
      mediaBaseUrl: "https://render.example",
      callback,
    }, 0);

    expect(result).toEqual({ kind: "complete" });
    expect(callback.mock.calls.map(([event]) => event)).toEqual([
      { kind: "progress", projectId: "p1", generationId: "g1", progress: 0.5 },
      { kind: "complete", projectId: "p1", generationId: "g1", outputPath: "renders/owner/p1/g1.mp4" },
    ]);
  });

  it("retries transient failures and reports a terminal failure on the final attempt", async () => {
    const callback = vi.fn(async (_event: RenderCallbackPayload) => {});
    const error = new Error("fetch https://storage.example/photo.jpg?signature=secret failed");
    const deps = {
      bundle: vi.fn().mockResolvedValue("bundle"),
      selectComposition: vi.fn().mockResolvedValue({ durationInFrames: 180 }),
      renderMedia: vi.fn().mockRejectedValue(error),
      outputDir: "/tmp/renders",
      mediaBaseUrl: "https://render.example",
      callback,
    };
    const requestBody = { ...body, job: { projectId: "p1", generationId: "g1", userId: "owner", outputPath: "renders/owner/p1/g1.mp4" } };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(executeQueuedRender(requestBody, deps, 0)).resolves.toMatchObject({ kind: "retry", reason: "Error: fetch https://storage.example/photo.jpg failed" });
    expect(callback).not.toHaveBeenCalled();
    await expect(executeQueuedRender(requestBody, deps, 2)).resolves.toEqual({ kind: "complete" });
    expect(callback).toHaveBeenCalledWith({ kind: "failed", projectId: "p1", generationId: "g1", reason: "Error: fetch https://storage.example/photo.jpg failed" });
    log.mockRestore();
  });

  it("continues to completion when a progress callback fails", async () => {
    const callback = vi.fn()
      .mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValue(undefined);
    const renderMedia = vi.fn(async (args: Record<string, unknown>) => {
      (args.onProgress as ((value: { progress: number }) => void) | undefined)?.({ progress: 0.5 });
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(executeQueuedRender({
      ...body,
      job: { projectId: "p1", generationId: "g1", userId: "owner", outputPath: "renders/owner/p1/g1.mp4" },
    }, {
      bundle: vi.fn().mockResolvedValue("bundle"),
      selectComposition: vi.fn().mockResolvedValue({ durationInFrames: 180 }),
      renderMedia,
      outputDir: "/tmp/renders",
      mediaBaseUrl: "https://render.example",
      callback,
    }, 0)).resolves.toEqual({ kind: "complete" });

    expect(callback).toHaveBeenNthCalledWith(2, { kind: "complete", projectId: "p1", generationId: "g1", outputPath: "renders/owner/p1/g1.mp4" });
    log.mockRestore();
  });
});

/** Parse the newline-delimited response the route streams. */
function lines(text: string): Array<Record<string, unknown>> {
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("POST /tasks/render", () => {
  it("renders through renderTimeline and reports the finished film", async () => {
    const { server, deps } = app();
    const res = await request(server).post("/tasks/render").send(body);

    expect(res.status).toBe(200);
    expect(lines(res.text).at(-1)).toEqual({
      done: true,
      outputPath: "/tmp/renders/out.mp4",
      durationInFrames: 180,
      uploaded: false,
    });
    expect(deps.renderMedia).toHaveBeenCalledWith(expect.objectContaining({ outputLocation: "/tmp/renders/out.mp4", codec: "h264" }));
  });

  it("rewrites every storage path to a URL Remotion can fetch", async () => {
    // Passing `uploads/owner/…` through verbatim made Remotion resolve it as a
    // relative URL, which 404s — a film of black frames that still reported
    // success.
    const { server, deps } = app();
    await request(server).post("/tasks/render").send({
      ...body,
      sources: { ...fixtureSources, film: "uploads/owner/p1/s1/a1/original.mp4", mochi: "https://signed.example/mochi.png" },
    });

    const props = (deps.selectComposition.mock.calls[0][0] as { inputProps: { sources: Record<string, string> } }).inputProps.sources;
    expect(props.film).toBe("http://127.0.0.1:8080/media/uploads/owner/p1/s1/a1/original.mp4");
    // Anything already a URL is left alone.
    expect(props.mochi).toBe("https://signed.example/mochi.png");
  });

  it("streams progress as it renders", async () => {
    const { server } = app({
      renderMedia: vi.fn().mockImplementation(async (args: { onProgress?: (p: { progress: number }) => void }) => {
        args.onProgress?.({ progress: 0.25 });
        args.onProgress?.({ progress: 0.75 });
      }),
    });
    const res = await request(server).post("/tasks/render").send(body);

    expect(lines(res.text).slice(0, 2)).toEqual([{ progress: 0.25 }, { progress: 0.75 }]);
  });

  it("builds the bundle once across two renders", async () => {
    // Task 11 step 1: a webpack build per request adds ten to thirty seconds to
    // every film.
    const build = vi.fn().mockResolvedValue("http://bundle");
    const { server } = app({ bundle: createBundleOnce(build) });

    await request(server).post("/tasks/render").send(body);
    await request(server).post("/tasks/render").send(body);

    expect(build).toHaveBeenCalledTimes(1);
  });

  it("uploads the finished file when the caller asks for it", async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const { server } = app({ upload });
    const res = await request(server).post("/tasks/render").send({ ...body, uploadUrl: "https://signed.example/put" });

    expect(upload).toHaveBeenCalledWith("https://signed.example/put", "/tmp/renders/out.mp4");
    expect(lines(res.text).at(-1)).toMatchObject({ done: true, uploaded: true });
  });

  it("reports a failed upload as a failed render, not a finished one", async () => {
    const { server } = app({ upload: vi.fn().mockRejectedValue(new Error("403")) });
    const res = await request(server).post("/tasks/render").send({ ...body, uploadUrl: "https://signed.example/put" });

    expect(lines(res.text).at(-1)).toMatchObject({ error: "render_failed" });
  });

  it("ends the stream with an error line when the render throws", async () => {
    const { server } = app({ renderMedia: vi.fn().mockRejectedValue(new Error("chromium died")) });
    const res = await request(server).post("/tasks/render").send(body);

    expect(lines(res.text).at(-1)).toMatchObject({ error: "render_failed", detail: "chromium died" });
    expect(lines(res.text).some((line) => "done" in line)).toBe(false);
  });

  it("rejects a malformed request before opening the stream", async () => {
    const { server } = app();
    const res = await request(server).post("/tasks/render").send({ ...body, outputFile: "../escape.mp4" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("accepts a film whose soundtrack has no resolvable source", async () => {
    // The soundtrack library does not exist, so nothing can turn a soundtrack
    // id into a file. Requiring one rejected every scored film there is.
    const { server } = app();
    const scored = {
      ...fixtureTimeline,
      audioClips: [{
        id: "a1",
        source: { kind: "soundtrack" as const, soundtrackId: "dusk", sourceInSec: 0, sourceOutSec: 6 },
        role: "music" as const,
        startSec: 0,
        gainDb: -6,
        fadeInSec: 1,
        fadeOutSec: 1,
      }],
    };
    const res = await request(server).post("/tasks/render").send({ ...body, timeline: scored });

    expect(lines(res.text).at(-1)).toMatchObject({ done: true });
  });
});
