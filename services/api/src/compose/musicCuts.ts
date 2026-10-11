export type CutClip = { kind: "photo" | "video" | "collage"; holdSec: number; minHoldSec: number; maxHoldSec: number; hasSpeech?: boolean; locked?: boolean; peak?: boolean; transitionOverlapSec?: number };
export type CutMusic = { hasPulse: boolean; beatsSec: number[]; downbeatsSec: number[]; downbeatStrength?: number[] };

/** Adjusts photo holds so eligible boundaries land on a nearby pulse. */
export function snapPhotoBoundaries<T extends CutClip>(clips: T[], music: CutMusic, cutOn: "beat" | "bar" | "free", toleranceSec = 0.25): T[] {
  if (cutOn === "free" || !music.hasPulse || music.beatsSec.length < 2) return clips;
  const out = clips.map((clip) => ({ ...clip }));
  const candidates = cutOn === "bar" ? music.downbeatsSec : music.beatsSec;
  if (!candidates.length) return out;
  let clipStart = 0;
  for (let index = 0; index < out.length - 1; index++) {
    const clip = out[index]!;
    const next = out[index + 1]!;
    const boundary = clipStart + clip.holdSec - (next.transitionOverlapSec ?? 0);
    const canMove = clip.kind === "photo" && !clip.hasSpeech && !(next.kind === "video" && next.hasSpeech) && !clip.locked;
    if (canMove) {
      const close = candidates.map((at, i) => ({ at, i, delta: at - boundary })).filter(({ delta }) => Math.abs(delta) <= toleranceSec && clip.holdSec + delta >= clip.minHoldSec && clip.holdSec + delta <= clip.maxHoldSec);
      const target = next.peak
        ? close.sort((a, b) => (music.downbeatStrength?.[b.i] ?? 0) - (music.downbeatStrength?.[a.i] ?? 0) || Math.abs(a.delta) - Math.abs(b.delta))[0]
        : close.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
      if (target) clip.holdSec = Number((clip.holdSec + target.delta).toFixed(3));
    }
    clipStart += clip.holdSec - (next.transitionOverlapSec ?? 0);
  }
  return out;
}
