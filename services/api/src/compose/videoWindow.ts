import type { Shot, TranscriptSegment } from "./buildCandidates.js";

export type VideoSignals = { stepSec: number; shake: number[]; blur: number[]; loud: number[] };
export type ScoredShot = Shot & { highlights?: { startSec: number; endSec: number; score: number }[]; signals?: VideoSignals };

// Keep all tuning weights together so sample-set tuning remains explicit.
export const VIDEO_WINDOW_WEIGHTS = { highlight: 1, loudPeak: 0.5, meanShakePenalty: 0.5, meanBlurPenalty: 0.5 } as const;
const STEP_SEC = 0.25;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function scoreWindow(shot: ScoredShot, startSec: number, endSec: number): number {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return 0;
  const duration = endSec - startSec;
  let score = 0;
  for (const h of shot.highlights ?? []) {
    const overlap = Math.max(0, Math.min(endSec, h.endSec) - Math.max(startSec, h.startSec));
    score += VIDEO_WINDOW_WEIGHTS.highlight * clamp01(h.score) * overlap / duration;
  }
  const signals = shot.signals;
  if (!signals) return score;
  const step = Number.isFinite(signals.stepSec) && signals.stepSec > 0 ? signals.stepSec : STEP_SEC;
  const indexes = signals.shake.map((_, i) => i).filter(i => shot.startSec + i * step < endSec && shot.startSec + (i + 1) * step > startSec);
  if (!indexes.length) return score;
  const mean = (values: number[]) => indexes.reduce((sum, i) => sum + (values[i] ?? 0), 0) / indexes.length;
  const peak = Math.max(0, ...indexes.map(i => signals.loud[i] ?? 0));
  return score + VIDEO_WINDOW_WEIGHTS.loudPeak * peak - VIDEO_WINDOW_WEIGHTS.meanShakePenalty * mean(signals.shake) - VIDEO_WINDOW_WEIGHTS.meanBlurPenalty * (1 - mean(signals.blur));
}

export function bestWindow(shot: ScoredShot, lengthSec: number, options: { speech?: TranscriptSegment[] } = {}): { inSec: number; outSec: number; score: number } | null {
  const duration = shot.endSec - shot.startSec;
  if (!Number.isFinite(shot.startSec) || !Number.isFinite(shot.endSec) || !(duration > 0)) return null;
  const signals = shot.signals;
  const speech = (options.speech ?? []).filter(s => s.endSec > shot.startSec && s.startSec < shot.endSec);
  if (duration < 4) {
    const count = Math.max(shot.signals?.shake.length ?? 0, shot.signals?.blur.length ?? 0);
    const allBad = count > 0 && Array.from({ length: count }, (_, i) => (shot.signals?.shake[i] ?? 0) > 0.6 || (shot.signals?.blur[i] ?? 1) < 0.4).every(Boolean);
    return allBad ? null : { inSec: shot.startSec, outSec: shot.endSec, score: scoreWindow(shot, shot.startSec, shot.endSec) };
  }
  let len = Math.min(Math.max(0.01, lengthSec), duration);
  const completeSentence = speech.find(s => s.endSec - s.startSec >= len - 0.01 && s.endSec - s.startSec <= 8 && s.startSec >= shot.startSec && s.endSec <= shot.endSec);
  if (completeSentence) len = completeSentence.endSec - completeSentence.startSec;
  if (completeSentence) return { inSec: completeSentence.startSec, outSec: completeSentence.endSec, score: scoreWindow(shot, completeSentence.startSec, completeSentence.endSec) };
  const candidates: { inSec: number; outSec: number; score: number; badStart: boolean }[] = [];
  const handle = 0.15;
  const firstStart = shot.startSec + handle;
  const maxTick = Math.floor((shot.endSec - handle - len - firstStart + 1e-8) / STEP_SEC);
  const qualityAtStart = (t: number) => {
    const step = Number.isFinite(signals?.stepSec) && (signals?.stepSec ?? 0) > 0 ? signals!.stepSec : STEP_SEC;
    const i = Math.floor((t - shot.startSec) / step);
    return Boolean(signals && ((signals.shake[i] ?? 0) > 0.6 || (signals.blur[i] ?? 1) < 0.4));
  };
  for (let tick = 0; tick <= maxTick; tick++) {
    const start = Number((firstStart + tick * STEP_SEC).toFixed(2));
    const end = Number((start + len).toFixed(2));
    if (speech.some(s => (start > s.startSec + 0.01 && start < s.endSec - 0.01) || (end > s.startSec + 0.01 && end < s.endSec - 0.01))) continue;
    candidates.push({ inSec: start, outSec: end, score: scoreWindow(shot, start, end), badStart: qualityAtStart(start) });
  }
  if (!candidates.length) return null;
  const clean = candidates.filter(c => !c.badStart);
  if (signals && clean.length === 0) return null;
  const pool = clean.length ? clean : candidates;
  const peakIndex = signals?.loud.length ? signals.loud.reduce((best, value, i, arr) => value > arr[best]! ? i : best, 0) : -1;
  const peakTime = peakIndex < 0 ? null : shot.startSec + peakIndex * (signals?.stepSec || STEP_SEC);
  pool.sort((a, b) => {
    const leadA = peakTime == null ? 0 : Math.abs(a.inSec - (peakTime - 0.3));
    const leadB = peakTime == null ? 0 : Math.abs(b.inSec - (peakTime - 0.3));
    return b.score - a.score || leadA - leadB || a.inSec - b.inSec;
  });
  return pool[0]!;
}
