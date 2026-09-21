import { MAX_SHOTS_PER_ASSET } from "../domain/media.js";
import { defaultRun, type Runner } from "./run.js";

export const SCENE_THRESHOLD = 0.3;
export const MIN_SHOT_SEC = 0.5;

export type ShotRange = { startSec: number; endSec: number };

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function parseSceneCuts(stderr: string): number[] {
  const cuts: number[] = [];
  for (const match of stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)) cuts.push(Number(match[1]));
  return cuts;
}

function build(cuts: number[], total: number, min: number): ShotRange[] {
  const inner = [...new Set(cuts.map(round3))].filter((cut) => cut > 0 && cut < total).sort((a, b) => a - b);
  const bounds = [0];
  for (const cut of inner) {
    if (cut - bounds[bounds.length - 1] >= min && total - cut >= min) bounds.push(cut);
  }
  bounds.push(total);
  return bounds.slice(1).map((end, i) => ({ startSec: bounds[i], endSec: end }));
}

/**
 * Every shot is at least `minShotSec` long and the shots tile [0, durationSec]
 * exactly. Past the cap the minimum doubles until the count fits, so a strobing
 * clip degrades to coarser shots instead of overflowing a Firestore transaction.
 */
export function shotsFromCuts(
  cuts: number[],
  durationSec: number,
  minShotSec: number = MIN_SHOT_SEC,
  maxShots: number = MAX_SHOTS_PER_ASSET,
): ShotRange[] {
  const total = round3(durationSec);
  let min = minShotSec;
  for (;;) {
    const shots = build(cuts, total, min);
    if (shots.length <= maxShots) return shots;
    min *= 2;
  }
}

/**
 * Run on the 360p proxy, not the original: the proxy preserves duration and sync,
 * scene detection reads every frame, and decoding a 4K original for that is waste.
 */
export async function detectShots(proxy: string, durationSec: number, run: Runner = defaultRun): Promise<ShotRange[]> {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-i", proxy, "-an",
    "-vf", `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
    "-f", "null", "-",
  ]);
  return shotsFromCuts(parseSceneCuts(stderr), durationSec);
}
