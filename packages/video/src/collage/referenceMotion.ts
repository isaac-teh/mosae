const clamp = (value: number) => Math.max(0, Math.min(1, value));
const timeScale = (durationSec: number) => Math.min(1, durationSec / 2.2);
export const referenceTime = (seconds: number, durationSec: number) => seconds / timeScale(durationSec);
export const revealAt = (seconds: number, start: number, span: number) => 1 - (1 - clamp((seconds - start) / span)) ** 3;

// The nine-photo reference translates a full canvas width and tumbles through
// a large angle, easing out cubically over 15 frames. Bottom row starts later.
const GRID_STARTS = [0, 3, 6, 9, 12, 15, 24, 27, 30];
const GRID_ROTATIONS = [165, -46, 142, -158, -38, 7, -169, -157, -91];
export function gridTileAt(seconds: number, index: number, durationSec: number) {
  const i = Math.min(index, GRID_STARTS.length - 1);
  const frame = referenceTime(seconds, durationSec) * 30;
  const progress = clamp((frame - GRID_STARTS[i]) / 15);
  if (progress === 1) return { translateX: 0, rotation: 0, opacity: 1 };
  const remaining = (1 - progress) ** 3;
  return { translateX: (i % 2 === 0 ? -100 : 100) * remaining, rotation: GRID_ROTATIONS[i] * remaining, opacity: frame < GRID_STARTS[i] ? 0 : i === 4 ? 1 - remaining : 1 };
}

// Photos in the scrapbook fade together; three lift upward and the lower
// right photo drifts down. Frame borders and decorations have separate timing.
export function scrapbookPhotoAt(seconds: number, index: number, durationSec: number) {
  const time = referenceTime(seconds, durationSec);
  const remaining = (1 - clamp(time / (22 / 30))) ** 2;
  const entrance = clamp((time - .2) / .5);
  const exitSpan = Math.min(.4, durationSec * .15);
  const exit = 1 - clamp((seconds - (durationSec - exitSpan)) / exitSpan);
  return { translateY: (index === 3 ? -22.5 : 21.5) * remaining, opacity: entrance * exit };
}
