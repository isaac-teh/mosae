// Poses measured from the supplied 800×800, 30fps reference. Its preview
// holds intermediate positions for several frames, then jumps to the next
// position; interpolating between them changes the character of the motion.
// Offsets below are percentages of the canvas, converted to each tile's size.
const START_FRAMES = [0, 3, 6, 10, 17, 16, 24, 27, 30];
const POSE_FRAMES = [8, 11, 14, 17, 22, 23, 32, 35, 38];
const LAND_FRAMES = [15, 18, 21, 24, 27, 30, 39, 42, 45];
const POSES = [
  { x: -12, y: -9.95, rotation: -4.5 },
  { x: -24.65, y: -9.95, rotation: 4.5 },
  { x: 24.65, y: -9.95, rotation: -4.5 },
  { x: -24.65, y: 6.25, rotation: 4.5 },
  { x: 18.65, y: 0, rotation: 3.5 },
  { x: 9, y: 6.25, rotation: 4.5 },
  { x: -12, y: 22.45, rotation: -4.5 },
  { x: -24.65, y: 22.45, rotation: 4.5 },
  { x: 24.65, y: 22.45, rotation: -4.5 },
];
export const mosaicTime = (seconds: number, durationSec: number) => seconds / Math.min(1, durationSec / 2.2);

export function mosaicEntranceAt(seconds: number, order: number, cell: { x: number; y: number; w: number; h: number }, durationSec: number) {
  const index = Math.max(0, Math.min(POSES.length - 1, order));
  const referenceFrame = Math.floor(mosaicTime(seconds, durationSec) * 30 + 1e-7);
  if (referenceFrame >= LAND_FRAMES[index]) return { translateX: 0, translateY: 0, rotation: 0, opacity: 1 };
  let pose = POSES[index];
  if (referenceFrame < POSE_FRAMES[index]) {
    // Most tiles initially sit above the canvas. The wide middle photo and
    // title instead have visible approach poses overlapping adjacent tiles.
    pose = index === 3 ? { x: -43.09, y: 0, rotation: -5 }
      : index === 4 ? { x: 24.65, y: 6.25, rotation: -4.5 }
      : { ...pose, y: -(cell.y + cell.h) };
  }
  return {
    translateX: pose.x / cell.w * 100,
    translateY: pose.y / cell.h * 100,
    rotation: pose.rotation,
    opacity: referenceFrame < START_FRAMES[index] ? 0 : 1,
  };
}
