import type { Timeline } from "@mosae/contracts";

/**
 * A six-second Timeline over the checked-in demo media. It exists so the render
 * container can be proven end to end before any real project data exists.
 */
export const fixtureTimeline: Timeline = {
  schemaVersion: 1,
  projectId: "fixture",
  mode: "memory",
  aspect: "9:16",
  fps: 30,
  durationSec: 6,
  chapters: [{ title: "Kyoto", startSec: 0 }],
  videoClips: [
    { id: "v1", source: { kind: "video", shotId: "film", sourceInSec: 0, sourceOutSec: 2 }, startSec: 0, durationSec: 2, transitionIn: { kind: "cut", durationSec: 0 } },
    { id: "p1", source: { kind: "photo", shotId: "mochi" }, startSec: 2, durationSec: 2, transitionIn: { kind: "crossfade", durationSec: 0.4 }, motion: { kind: "slow-zoom", from: 1, to: 1.08 } },
    { id: "p2", source: { kind: "photo", shotId: "birthday" }, startSec: 4, durationSec: 2, transitionIn: { kind: "crossfade", durationSec: 0.4 }, motion: { kind: "slow-zoom", from: 1.03, to: 1.12 } },
  ],
  audioClips: [],
  captions: [{ text: "Kyoto, day four", startSec: 0, endSec: 2 }],
};

/** Paths are relative to the Remotion public directory set in remotion.config.ts. */
export const fixtureSources: Record<string, string> = {
  film: "film.mp4",
  mochi: "figma/review-moments/imgMeiEatingStrawberryMochi.png",
  birthday: "figma/review-moments/imgMeiClappingAtBirthdayCakeWithParents.png",
};
