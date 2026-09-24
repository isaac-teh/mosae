import { describe, it, expect, vi } from "vitest";
import { resolveSources, collectSourceIds } from "./resolveSources.js";
import type { Timeline } from "@mosae/contracts";

const makeTimeline = (overrides?: Partial<Timeline>): Timeline => ({
  schemaVersion: 1,
  projectId: "proj-1",
  mode: "creator" as const,
  aspect: "9:16" as const,
  fps: 30,
  durationSec: 4,
  chapters: [{ title: "Chapter 1", startSec: 0 }],
  videoClips: [
    {
      id: "clip-1",
      source: { kind: "photo" as const, shotId: "shot-photo-1" },
      startSec: 0,
      durationSec: 4,
      transitionIn: { kind: "cut" as const, durationSec: 0 },
    },
  ],
  audioClips: [],
  captions: [],
  ...overrides,
});

const mockDeps = (assets: Record<string, { storagePath: string; derivatives?: { proxyPath?: string | null; renderPath?: string | null; thumbPath: string } }>) => ({
  loadAsset: vi.fn(async (projectId: string, assetId: string) => assets[assetId] ?? null),
});

describe("resolveSources", () => {
  it("resolves a photo shotId to proxy path in preview mode", async () => {
    const timeline = makeTimeline();
    const deps = mockDeps({
      "shot-photo-1": {
        storagePath: "uploads/alice/p1/s1/a1/original.jpg",
        derivatives: { thumbPath: "proxies/u/p/a/1/thumb.jpg", proxyPath: "proxies/u/p/a/1/proxy.mp4" },
      },
    });

    const sources = await resolveSources(timeline, deps, "proj-1", "preview");

    expect(sources["shot-photo-1"]).toBe("proxies/u/p/a/1/proxy.mp4");
  });

  it("resolves a photo shotId to original path in render mode", async () => {
    const timeline = makeTimeline();
    const deps = mockDeps({
      "shot-photo-1": {
        storagePath: "uploads/alice/p1/s1/a1/original.jpg",
        derivatives: { thumbPath: "proxies/u/p/a/1/thumb.jpg" },
      },
    });

    const sources = await resolveSources(timeline, deps, "proj-1", "render");

    expect(sources["shot-photo-1"]).toBe("uploads/alice/p1/s1/a1/original.jpg");
  });

  it("falls back to thumbPath when proxyPath is null in preview mode", async () => {
    const timeline = makeTimeline();
    const deps = mockDeps({
      "shot-photo-1": {
        storagePath: "uploads/alice/p1/s1/a1/original.jpg",
        derivatives: { thumbPath: "proxies/u/p/a/1/thumb.jpg" },
      },
    });

    const sources = await resolveSources(timeline, deps, "proj-1", "preview");

    expect(sources["shot-photo-1"]).toBe("proxies/u/p/a/1/thumb.jpg");
  });

  it("throws when a shotId has no matching asset", async () => {
    const timeline = makeTimeline();
    const deps = mockDeps({});

    await expect(resolveSources(timeline, deps, "proj-1")).rejects.toThrow("missing source: shot-photo-1");
  });

  it("resolves audio clip assetId alongside video shotIds", async () => {
    const timeline = makeTimeline({
      audioClips: [
        {
          id: "audio-1",
          source: { kind: "asset" as const, assetId: "shot-audio-1", sourceInSec: 0, sourceOutSec: 4 },
          role: "speech",
          startSec: 0,
          gainDb: 0,
          fadeInSec: 0,
          fadeOutSec: 0,
        },
      ],
    });

    const deps = mockDeps({
      "shot-photo-1": {
        storagePath: "uploads/alice/p1/s1/a1/original.jpg",
        derivatives: { thumbPath: "proxies/u/p/a/1/thumb.jpg" },
      },
      "shot-audio-1": {
        storagePath: "uploads/alice/p1/s1/a2/original.mp4",
        derivatives: { thumbPath: "proxies/u/p/a/2/thumb.jpg", proxyPath: "proxies/u/p/a/2/proxy.mp4" },
      },
    });

    const sources = await resolveSources(timeline, deps, "proj-1", "render");

    expect(sources["shot-photo-1"]).toBe("uploads/alice/p1/s1/a1/original.jpg");
    expect(sources["shot-audio-1"]).toBe("uploads/alice/p1/s1/a2/original.mp4");
  });

  it("omits a soundtrack when no library is configured, rather than failing the film", async () => {
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "clip-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        },
      ],
      audioClips: [
        {
          id: "audio-1",
          source: { kind: "soundtrack" as const, soundtrackId: "bgm-001", sourceInSec: 0, sourceOutSec: 4 },
          role: "music",
          startSec: 0,
          gainDb: -6,
          fadeInSec: 0.5,
          fadeOutSec: 0.5,
        },
      ],
    });

    const deps = mockDeps({
      "shot-photo-1": {
        storagePath: "uploads/alice/p1/s1/a1/original.jpg",
        derivatives: { thumbPath: "proxies/u/p/a/1/thumb.jpg" },
      },
    }); // No soundtrack library exists yet

    const sources = await resolveSources(timeline, deps, "proj-1", "render");

    expect(sources["shot-photo-1"]).toBe("uploads/alice/p1/s1/a1/original.jpg");
    // The other side of this agreement is pinned in `services/render`
    // (`renderRoute.test.ts`, "accepts a film whose soundtrack has no
    // resolvable source"): `missingSources` no longer requires a soundtrack id.
    // The two used to disagree — this omitted the id and `parseRenderRequest`
    // required it, so every scored film was rejected, the golden fixture
    // included.
    expect(sources["bgm-001"]).toBeUndefined();
    expect(Object.keys(sources)).toEqual(["shot-photo-1"]);
  });

  it("resolves a soundtrack through its library when one is configured", async () => {
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "clip-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        },
      ],
      audioClips: [
        {
          id: "audio-1",
          source: { kind: "soundtrack" as const, soundtrackId: "bgm-001", sourceInSec: 0, sourceOutSec: 4 },
          role: "music",
          startSec: 0,
          gainDb: -6,
          fadeInSec: 0.5,
          fadeOutSec: 0.5,
        },
      ],
    });

    const deps = {
      ...mockDeps({ "shot-photo-1": { storagePath: "uploads/a.jpg", derivatives: { thumbPath: "t.jpg" } } }),
      loadSoundtrack: async (id: string) => `soundtracks/${id}.m4a`,
    };

    const sources = await resolveSources(timeline, deps, "proj-1", "render");
    expect(sources["bgm-001"]).toBe("soundtracks/bgm-001.m4a");
  });

  it("fails when a configured library cannot resolve the soundtrack", async () => {
    // A library that does not have the track is a broken film, not a silent one.
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "clip-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        },
      ],
      audioClips: [
        {
          id: "audio-1",
          source: { kind: "soundtrack" as const, soundtrackId: "bgm-404", sourceInSec: 0, sourceOutSec: 4 },
          role: "music",
          startSec: 0,
          gainDb: -6,
          fadeInSec: 0.5,
          fadeOutSec: 0.5,
        },
      ],
    });

    const deps = {
      ...mockDeps({ "shot-photo-1": { storagePath: "uploads/a.jpg", derivatives: { thumbPath: "t.jpg" } } }),
      loadSoundtrack: async () => null,
    };

    await expect(resolveSources(timeline, deps, "proj-1", "render")).rejects.toThrow(/missing soundtrack: bgm-404/);
  });

  it("deduplicates identical shotIds across clips", async () => {
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "clip-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 2,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        },
        {
          id: "clip-2",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 2,
          durationSec: 2,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        },
      ],
    });

    const deps = mockDeps({
      "shot-photo-1": {
        storagePath: "uploads/alice/p1/s1/a1/original.jpg",
        derivatives: { thumbPath: "proxies/u/p/a/1/thumb.jpg" },
      },
    });

    const sources = await resolveSources(timeline, deps, "proj-1", "render");

    expect(Object.keys(sources)).toHaveLength(1);
    expect(sources["shot-photo-1"]).toBe("uploads/alice/p1/s1/a1/original.jpg");
  });
});

describe("collectSourceIds", () => {
  it("collects shotId from video clips", () => {
    const timeline = makeTimeline();
    const ids = collectSourceIds(timeline);

    expect(ids).toContain("shot-photo-1");
    expect(ids.size).toBe(1);
  });

  it("collects assetId from audio clips but not soundtrackId", () => {
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "clip-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        },
      ],
      audioClips: [
        {
          id: "audio-1",
          source: { kind: "asset" as const, assetId: "shot-audio-1", sourceInSec: 0, sourceOutSec: 4 },
          role: "speech",
          startSec: 0,
          gainDb: 0,
          fadeInSec: 0,
          fadeOutSec: 0,
        },
        {
          id: "audio-2",
          source: { kind: "soundtrack" as const, soundtrackId: "bgm-001", sourceInSec: 0, sourceOutSec: 4 },
          role: "music",
          startSec: 0,
          gainDb: -6,
          fadeInSec: 0.5,
          fadeOutSec: 0.5,
        },
      ],
    });

    const ids = collectSourceIds(timeline);

    expect(ids).toContain("shot-photo-1");
    expect(ids).toContain("shot-audio-1");
    expect(ids.has("bgm-001")).toBe(false);
    expect(ids.size).toBe(2);
  });
});
