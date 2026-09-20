export const FPS = 30;

export type Transition =
  | { type: "cut" }
  | { type: "crossfade"; durationFrames: number };

export type Clip = {
  id: string;
  kind: "video" | "photo";
  src: string;
  durationFrames: number;
  sourceStartFrame?: number;
  transitionOut?: Transition;
  motion?: { type: "slow-zoom-in"; from: number; to: number };
};

export type Soundtrack = {
  src: string;
  volume: number;
  fadeInFrames: number;
  fadeOutFrames: number;
};

export type EditDecisionList = {
  fps: number;
  width: number;
  height: number;
  clips: Clip[];
  soundtrack?: Soundtrack;
};

/**
 * A hand-authored decision list. This is the exact contract that the AI planner
 * will eventually produce, after validation, rather than generating React code.
 */
export const birthdayStoryEdit: EditDecisionList = {
  fps: FPS,
  width: 1080,
  height: 1350,
  clips: [
    { id: "arrival", kind: "video", src: "film.mp4", sourceStartFrame: 0, durationFrames: 120, transitionOut: { type: "crossfade", durationFrames: 12 } },
    { id: "mochi", kind: "photo", src: "figma/review-moments/imgMeiEatingStrawberryMochi.png", durationFrames: 84, motion: { type: "slow-zoom-in", from: 1, to: 1.08 }, transitionOut: { type: "crossfade", durationFrames: 12 } },
    { id: "birthday", kind: "photo", src: "figma/review-moments/imgMeiClappingAtBirthdayCakeWithParents.png", durationFrames: 105, motion: { type: "slow-zoom-in", from: 1.03, to: 1.12 }, transitionOut: { type: "cut" } },
    { id: "closing", kind: "video", src: "film.mp4", sourceStartFrame: 360, durationFrames: 135, transitionOut: { type: "cut" } }
  ]
};

export function overlapAfter(clip: Clip): number {
  return clip.transitionOut?.type === "crossfade" ? clip.transitionOut.durationFrames : 0;
}

export function editDurationFrames(edit: EditDecisionList): number {
  return edit.clips.reduce((total, clip, index) => total + clip.durationFrames - (index === edit.clips.length - 1 ? 0 : overlapAfter(clip)), 0);
}
