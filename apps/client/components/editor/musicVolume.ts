/** Converts the timeline's dB gain to the editor's perceptual 0–100 slider. */
export function gainDbToVolumePercent(gainDb: number): number {
  if (gainDb <= -60) return 0;
  return Math.max(0, Math.min(100, Math.round(100 * 10 ** (gainDb / 20))));
}

/** 100 is unity, 0 is the timeline's silent -60 dB sentinel. */
export function volumePercentToGainDb(percent: number): number {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  return safePercent === 0 ? -60 : Math.max(-60, Math.min(0, 20 * Math.log10(safePercent / 100)));
}
