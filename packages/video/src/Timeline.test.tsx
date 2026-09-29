import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fixtureTimeline } from "./fixtureTimeline";

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Sequence: ({ children, from, durationInFrames }: React.PropsWithChildren<{ from: number; durationInFrames: number }>) => <section data-from={from} data-duration={durationInFrames}>{children}</section>,
  Img: ({ src }: { src: string }) => <img src={src} />,
  OffthreadVideo: ({ src }: { src: string }) => <video src={src} />,
  Audio: () => null,
  useCurrentFrame: () => 14,
  useVideoConfig: () => ({ fps: 30, width: 360, height: 640, durationInFrames: 180 }),
  interpolate: (value: number, input: number[], output: number[]) => {
    const fraction = Math.min(1, Math.max(0, (value - input[0]) / (input.at(-1)! - input[0] || 1)));
    return output[0] + fraction * (output.at(-1)! - output[0]);
  },
  random: () => 0.5,
  spring: () => 1,
}));

import { MosaeTimeline } from "./Timeline";

describe("MosaeTimeline", () => {
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
            { slotId: "one", shotId: "shot-a", kind: "photo" as const },
            { slotId: "two", shotId: "shot-b", kind: "photo" as const },
            { slotId: "three", shotId: "shot-c", kind: "photo" as const },
          ],
        },
      }],
    };
    const html = renderToStaticMarkup(<MosaeTimeline timeline={timeline} sources={{ "shot-a": "/a.jpg", "shot-b": "/b.jpg", "shot-c": "/c.jpg" }} />);
    expect(html).toContain('data-from="60" data-duration="90"');
    expect(html).toContain('src="/a.jpg"');
    expect(html).toContain('src="/b.jpg"');
    expect(html).toContain('src="/c.jpg"');
  });
});
