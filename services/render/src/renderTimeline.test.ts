import { describe, it, expect, vi } from "vitest";
import { parseRenderRequest, renderTimeline } from "./renderTimeline.js";
import { fixtureSources, fixtureTimeline } from "@mosae/video/fixture";

function deps(overrides: Record<string, unknown> = {}) {
  return {
    bundle: vi.fn().mockResolvedValue("http://bundle"),
    selectComposition: vi.fn().mockResolvedValue({ id: "MosaeTimeline", durationInFrames: 180, fps: 30, width: 1080, height: 1920 }),
    renderMedia: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const request = { timeline: fixtureTimeline, sources: fixtureSources, outputPath: "/tmp/out.mp4" };

describe("renderTimeline", () => {
  it("selects the MosaeTimeline composition and renders to the requested path", async () => {
    const d = deps();
    const result = await renderTimeline(request, d as never);
    expect(result).toMatchObject({ outputPath: "/tmp/out.mp4", durationInFrames: 180 });
    expect(d.selectComposition).toHaveBeenCalledWith(expect.objectContaining({ id: "MosaeTimeline", serveUrl: "http://bundle" }));
    expect(d.renderMedia).toHaveBeenCalledWith(expect.objectContaining({ outputLocation: "/tmp/out.mp4", codec: "h264" }));
  });

  it("passes the timeline and sources through as input props, so metadata is derived from them", async () => {
    const d = deps();
    await renderTimeline(request, d as never);
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
    await renderTimeline(request, { ...d, onProgress } as never);
    expect(onProgress).toHaveBeenCalledWith(0.5);
  });

  it("surfaces a bundling failure rather than reporting a successful render", async () => {
    const d = deps({ bundle: vi.fn().mockRejectedValue(new Error("bundle failed")) });
    await expect(renderTimeline(request, d as never)).rejects.toThrow("bundle failed");
  });
});

describe("parseRenderRequest", () => {
  it("accepts a well-formed request", () => {
    expect(parseRenderRequest(request).outputPath).toBe("/tmp/out.mp4");
  });

  it("rejects a request whose timeline does not match the contract", () => {
    expect(() => parseRenderRequest({ ...request, timeline: { ...fixtureTimeline, fps: 24 } })).toThrow(/timeline/i);
  });

  it("rejects a request with no output path", () => {
    expect(() => parseRenderRequest({ timeline: fixtureTimeline, sources: fixtureSources })).toThrow(/outputPath/i);
  });

  it("rejects a sources map that does not cover every referenced clip", () => {
    expect(() => parseRenderRequest({ ...request, sources: { film: "film.mp4" } })).toThrow(/mochi|missing source/i);
  });
});
