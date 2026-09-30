import { describe, it, expect, vi } from "vitest";
import { formatRenderTiming, parseRenderRequest, renderTimeline, resolveOutputPath } from "./renderTimeline.js";
import { fixtureSources, fixtureTimeline } from "@mosae/video/fixture";

function deps(overrides: Record<string, unknown> = {}) {
  return {
    bundle: vi.fn().mockResolvedValue("http://bundle"),
    selectComposition: vi.fn().mockImplementation(({ inputProps }: { inputProps: { timeline: { aspect: string } } }) => Promise.resolve({ id: "MosaeTimeline", durationInFrames: 180, fps: 30, width: inputProps.timeline.aspect === "9:16" ? 1080 : 1920, height: inputProps.timeline.aspect === "9:16" ? 1920 : 1080 })),
    renderMedia: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const request = { timeline: fixtureTimeline, sources: fixtureSources, outputFile: "out.mp4" };

describe("renderTimeline", () => {
  it("formats one render_timing line with every required field", () => {
    const line = formatRenderTiming({ serveUrlMs: 11, selectMs: 22, renderMs: 33, startedAt: 0, frames: 180, width: 1080, height: 1920, fps: 30 }, 44, 110);
    expect(line).toBe('render_timing {"serveUrlMs":11,"selectMs":22,"renderMs":33,"uploadMs":44,"totalMs":110,"frames":180,"width":1080,"height":1920,"fps":30}');
  });
  it("selects the MosaeTimeline composition and renders to the requested path", async () => {
    const d = deps();
    const result = await renderTimeline(request, d as never, "/tmp/renders");
    expect(result).toMatchObject({ outputPath: "/tmp/renders/out.mp4", durationInFrames: 180 });
    expect(d.selectComposition).toHaveBeenCalledWith(expect.objectContaining({ id: "MosaeTimeline", serveUrl: "http://bundle" }));
    expect(d.renderMedia).toHaveBeenCalledWith(expect.objectContaining({ outputLocation: "/tmp/renders/out.mp4", codec: "h264" }));
  });

  it.each([["720p", 2 / 3], ["1080p", 1]] as const)("renders %s at the expected scale", async (resolution, scale) => {
    const d = deps();
    await renderTimeline({ ...request, resolution }, d as never, "/tmp/renders");
    expect(d.renderMedia).toHaveBeenCalledWith(expect.objectContaining({ scale }));
  });

  it("keeps a 16:9 timeline at 1280x720 in 720p", async () => {
    const timeline = { ...fixtureTimeline, aspect: "16:9" as const };
    const result = await renderTimeline({ ...request, timeline }, deps() as never, "/tmp/renders");
    expect(result.timings).toMatchObject({ width: 1280, height: 720, fps: 30 });
  });

  it("defaults a missing resolution to 720p", async () => {
    expect(parseRenderRequest(request).resolution).toBe("720p");
    const d = deps();
    await renderTimeline(request, d as never, "/tmp/renders");
    expect(d.renderMedia).toHaveBeenCalledWith(expect.objectContaining({ scale: 2 / 3 }));
    expect((await renderTimeline(request, d as never, "/tmp/renders")).timings).toMatchObject({ width: 720, height: 1280, fps: 30 });
  });

  it("passes the timeline and sources through as input props, so metadata is derived from them", async () => {
    const d = deps();
    await renderTimeline(request, d as never, "/tmp/renders");
    const selectArgs = d.selectComposition.mock.calls[0][0] as { inputProps: { timeline: unknown; sources: unknown } };
    expect(selectArgs.inputProps.timeline).toEqual(fixtureTimeline);
    expect(selectArgs.inputProps.sources).toEqual(fixtureSources);
  });

  it("reports progress when the renderer emits it", async () => {
    const onProgress = vi.fn();
    const d = deps({
      renderMedia: vi.fn().mockImplementation(async (args: { onProgress?: (p: { progress: number }) => void }) => {
        args.onProgress?.({ progress: 0.5 });
      }),
    });
    await renderTimeline(request, { ...d, onProgress } as never, "/tmp/renders");
    expect(onProgress).toHaveBeenCalledWith(0.5);
  });

  it("surfaces a bundling failure rather than reporting a successful render", async () => {
    const d = deps({ bundle: vi.fn().mockRejectedValue(new Error("bundle failed")) });
    await expect(renderTimeline(request, d as never, "/tmp/renders")).rejects.toThrow("bundle failed");
  });
});

describe("parseRenderRequest", () => {
  it("requires a resolved source for each collage slot", () => {
    const timeline = {
      ...fixtureTimeline, schemaVersion: 2,
      videoClips: [{
        kind: "collage", clipId: "collage-1", startSec: 0, durationSec: 6,
        spec: {
          layoutId: "torn-paper", motionId: "print-drop", effectId: null,
          seed: "fixture", durationSec: 6,
          slots: [
            { slotId: "one", shotId: "shot-a", kind: "photo" },
            { slotId: "two", shotId: "shot-b", kind: "photo" },
            { slotId: "three", shotId: "shot-c", kind: "photo" },
          ],
        },
      }],
    };
    expect(() => parseRenderRequest({ timeline, sources: { "shot-a": "/a.jpg", "shot-b": "/b.jpg" }, outputFile: "collage.mp4" })).toThrow(/shot-c/);
    expect(parseRenderRequest({ timeline, sources: { "shot-a": "/a.jpg", "shot-b": "/b.jpg", "shot-c": "/c.jpg" }, outputFile: "collage.mp4" }).timeline.schemaVersion).toBe(2);
  });
  it("accepts a well-formed request", () => {
    expect(parseRenderRequest(request).outputFile).toBe("out.mp4");
  });

  it("preserves callback metadata for a queued render job", () => {
    const parsed = parseRenderRequest({
      ...request,
      job: { projectId: "p1", generationId: "g1", userId: "owner", outputPath: "renders/owner/p1/g1.mp4" },
    });
    expect(parsed.job).toEqual({ projectId: "p1", generationId: "g1", userId: "owner", outputPath: "renders/owner/p1/g1.mp4" });
  });

  it("rejects malformed callback metadata", () => {
    expect(() => parseRenderRequest({ ...request, job: { projectId: "p1" } })).toThrow(/job metadata/i);
  });

  it("rejects a request whose timeline does not match the contract", () => {
    expect(() => parseRenderRequest({ ...request, timeline: { ...fixtureTimeline, fps: 24 } })).toThrow(/timeline/i);
  });

  it("rejects a request with no output file", () => {
    expect(() => parseRenderRequest({ timeline: fixtureTimeline, sources: fixtureSources })).toThrow(/outputFile/i);
  });

  it("rejects a sources map that does not cover every referenced clip", () => {
    expect(() => parseRenderRequest({ ...request, sources: { film: "film.mp4" } })).toThrow(/mochi|missing source/i);
  });
});

describe("resolveOutputPath", () => {
  it("resolves valid output filenames under the render directory", () => {
    expect(resolveOutputPath("/tmp/renders", "film_01.mp4")).toBe("/tmp/renders/film_01.mp4");
  });

  it.each(["../x.mp4", "/abs.mp4", "a/b.mp4", "x.mov", "", `${"a".repeat(129)}.mp4`])("rejects unsafe output filename %j", (outputFile) => {
    expect(() => resolveOutputPath("/tmp/renders", outputFile)).toThrow(/outputFile/i);
  });
});
