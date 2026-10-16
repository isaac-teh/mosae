import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const frameState = vi.hoisted(() => ({ current: 14 }));
import { fixtureTimeline } from "./fixtureTimeline";

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
  Sequence: ({ children, from, durationInFrames }: React.PropsWithChildren<{ from: number; durationInFrames: number }>) => <section data-from={from} data-duration={durationInFrames}>{children}</section>,
  Img: ({ src, style, ...props }: { src: string; style?: React.CSSProperties; [key: string]: unknown }) => <img src={src} style={style} {...props} />,
  OffthreadVideo: ({ src, style }: { src: string; style?: React.CSSProperties }) => <video src={src} style={style} />,
  Audio: () => null,
  useCurrentFrame: () => frameState.current,
  useVideoConfig: () => ({ fps: 30, width: 360, height: 640, durationInFrames: 180 }),
  interpolate: (value: number, input: number[], output: number[]) => {
    const fraction = Math.min(1, Math.max(0, (value - input[0]) / (input.at(-1)! - input[0] || 1)));
    return output[0] + fraction * (output.at(-1)! - output[0]);
  },
  random: () => 0.5,
  spring: () => 1,
}));

import { MosaeTimeline } from "./Timeline";
import { clipFitForSource } from "./timelineMetadata";

beforeEach(() => { frameState.current = 14; });

describe("clipFitForSource", () => {
  it("uses blurred fill for orientation mismatches and cover otherwise", () => {
    expect(clipFitForSource({ width: 400, height: 800 }, "16:9")).toBe("fill");
    expect(clipFitForSource({ width: 800, height: 400 }, "16:9")).toBe("cover");
    expect(clipFitForSource({ width: 800, height: 400 }, "9:16")).toBe("fill");
  });
  it("keeps user crops in cover mode and unknown dimensions safe", () => {
    expect(clipFitForSource({ width: 400, height: 800 }, "16:9", { x: 0.5 })).toBe("cover");
    expect(clipFitForSource(undefined, "16:9")).toBe("cover");
  });
});

describe("MosaeTimeline", () => {
  it.each(["9:16", "16:9"] as const)("ignores an incoming transition on the first clip at frame zero in %s", (aspect) => {
    frameState.current = 0;
    const timeline = {
      ...fixtureTimeline,
      aspect,
      videoClips: [
        { id: "opening", source: { kind: "photo" as const, shotId: "first" }, startSec: 0, durationSec: 3, transitionIn: { kind: "crossfade" as const, durationSec: 0.4 } },
        { id: "next", source: { kind: "photo" as const, shotId: "second" }, startSec: 2.6, durationSec: 3, transitionIn: { kind: "crossfade" as const, durationSec: 0.4 } },
      ],
    };

    const html = renderToStaticMarkup(<MosaeTimeline timeline={timeline} sources={{ first: "/first.jpg", second: "/second.jpg" }} />);
    const openingAndNextOpacity = [...html.matchAll(/<div style="opacity:([^\"]+)">/g)].map((match) => match[1]);

    expect(openingAndNextOpacity).toEqual(["1", "0"]);
    frameState.current = 14;
  });

  it("renders video selection layers only when an editor selection handler is supplied", () => {
    const passive = renderToStaticMarkup(<MosaeTimeline timeline={fixtureTimeline} sources={{ film: "/film.mp4" }} />);
    expect(passive).not.toContain('aria-label="Select video clip"');
    const onSelectClip = vi.fn();
    const active = renderToStaticMarkup(<MosaeTimeline timeline={fixtureTimeline} sources={{ film: "/film.mp4" }} onSelectClip={onSelectClip} />);
    expect(active).toContain('aria-label="Select video clip"');
  });

  it("stacks a portrait photo over the blurred fill and applies motion to the foreground", () => {
    const timeline = {
      ...fixtureTimeline,
      aspect: "16:9" as const,
      videoClips: [{
        id: "portrait-first",
        source: { kind: "photo" as const, shotId: "portrait", width: 400, height: 800 },
        startSec: 0,
        durationSec: 2,
        transitionIn: { kind: "cut" as const, durationSec: 0 },
        motion: { kind: "slow-zoom" as const, from: 1, to: 1.1, center: { cx: 0.2, cy: 0.35 } },
      }],
    };
    const html = renderToStaticMarkup(<MosaeTimeline timeline={timeline} sources={{ portrait: "/portrait.jpg" }} />);

    const backgroundIndex = html.indexOf('data-blurred-fill-background="true"');
    const foregroundIndex = html.indexOf('data-photo-media="true"');
    expect(backgroundIndex).toBeGreaterThanOrEqual(0);
    expect(foregroundIndex).toBeGreaterThan(backgroundIndex);
    expect(html.slice(backgroundIndex, foregroundIndex)).toContain("z-index:0");
    expect(html.slice(backgroundIndex, foregroundIndex)).toContain("filter:blur(40px) brightness(0.6)");
    expect(html.slice(backgroundIndex, foregroundIndex)).toContain("transform:scale(1.15)");
    const foreground = html.slice(html.lastIndexOf('style="', foregroundIndex), html.indexOf(">", foregroundIndex));
    expect(foreground).toContain("position:absolute;inset:0;z-index:1");
    expect(foreground).toContain("object-fit:contain");
    expect(foreground).toContain("transform:scale(1.0233333333333334) rotate(0deg)");
    expect(foreground).toContain("transform-origin:20% 35%");
    expect(foreground).not.toContain("scale(1.15)");
  });

  it("renders a collage video cell as video", () => {
    const timeline = {
      ...fixtureTimeline, schemaVersion: 2 as const,
      videoClips: [{
        kind: "collage" as const, clipId: "collage-video", startSec: 0, durationSec: 3,
        spec: {
          layoutId: "torn-paper" as const, motionId: "print-drop" as const, effectId: null,
          seed: "fixture", durationSec: 3,
          slots: [
            { slotId: "one", shotId: "video-shot", kind: "video" as const },
            { slotId: "two", shotId: "photo-a", kind: "photo" as const },
            { slotId: "three", shotId: "photo-b", kind: "photo" as const },
          ],
        },
      }],
    };
    const html = renderToStaticMarkup(<MosaeTimeline timeline={timeline} sources={{ "video-shot": "/video.mp4", "photo-a": "/a.jpg", "photo-b": "/b.jpg" }} />);
    expect(html).toContain('<video src="/video.mp4"');
  });

  it("renders a collage within its timed Sequence using resolved slot sources", () => {
    const timeline = {
      ...fixtureTimeline,
      schemaVersion: 2 as const,
      videoClips: [{
        kind: "collage" as const, clipId: "collage-1", startSec: 2, durationSec: 3,
        spec: {
          layoutId: "torn-paper" as const, motionId: "print-drop" as const, effectId: null,
          seed: "fixture", durationSec: 3,
          slots: [
            { slotId: "one", shotId: "shot-a", kind: "photo" as const, crop: { x: 0.7, y: 0.2, scale: 2 } },
            { slotId: "two", shotId: "shot-b", kind: "photo" as const },
            { slotId: "three", shotId: "shot-c", kind: "photo" as const },
          ],
        },
      }],
    };
    const html = renderToStaticMarkup(<MosaeTimeline timeline={timeline} sources={{ "shot-a": "/a.jpg", "shot-b": "/b.jpg", "shot-c": "/c.jpg" }} />);
    expect(html).toContain('data-from="60" data-duration="90"');
    expect(html).toContain('src="/a.jpg"');
    expect(html).toContain('object-position:70% 20%');
    expect(html).toContain('transform:scale(2)');
    expect(html).toContain('src="/b.jpg"');
    expect(html).toContain('src="/c.jpg"');
  });
});
