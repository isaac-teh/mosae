// Code builds every legal clip before the model chooses.
// The model picked illegal ranges on its own: spanning two shots, or slicing a
// sentence in half. Those are arithmetic, not taste, so code does them here and
// the model only selects and orders what is already valid.
export type Candidate = {
  candidateId: string;
  itemId: string;
  kind: 'photo' | 'video';
  chapterIndex: number;
  inSec?: number;
  outSec?: number;
  lengthSec?: number;
  minHoldSec?: number;
  maxHoldSec?: number;
  hasSpeech?: boolean;
  description: string;
};

type Shot = { startSec: number; endSec: number; description?: string; role?: string; quality?: number; usable?: boolean };
type Segment = { startSec: number; endSec: number; text: string };

const MIN_CLIP = 1.2;
const HANDLE = 0.15; // leave a little room at each end so a crossfade has something to work with

// A range is legal when it sits inside one shot and does not start or end inside speech.
function legalRanges(shot: Shot, transcript: Segment[], maxLen: number) {
  const inside = transcript.filter(s => s.endSec > shot.startSec && s.startSec < shot.endSec).sort((a, b) => a.startSec - b.startSec);
  const ranges: { inSec: number; outSec: number; hasSpeech: boolean }[] = [];
  // Whole speech segments, clamped to the shot, keep a sentence intact.
  for (const segment of inside) {
    const inSec = Math.max(shot.startSec, segment.startSec);
    const outSec = Math.min(shot.endSec, segment.endSec);
    if (outSec - inSec >= MIN_CLIP) ranges.push({ inSec, outSec: Math.min(outSec, inSec + maxLen), hasSpeech: true });
  }
  // Gaps between speech (or the whole shot when it is silent) are free to cut.
  const bounds = [shot.startSec, ...inside.flatMap(s => [s.startSec, s.endSec]), shot.endSec];
  for (let i = 0; i < bounds.length - 1; i += 2) {
    const inSec = bounds[i] + (i === 0 ? HANDLE : 0);
    const outSec = Math.min(bounds[i + 1] - (i + 2 >= bounds.length ? HANDLE : 0), inSec + maxLen);
    if (outSec - inSec >= MIN_CLIP) ranges.push({ inSec: Number(inSec.toFixed(2)), outSec: Number(outSec.toFixed(2)), hasSpeech: false });
  }
  return ranges;
}

export function buildCandidates(
  chapters: { index: number; itemIds: string[] }[],
  assets: Map<string, any>,
  holds: { min: number; max: number },
  perItem = 6,
): Candidate[] {
  const out: Candidate[] = [];
  // A story may place the same item in several chapters (a long interview often is
  // the spine of the whole piece), so candidates are built per chapter, not once
  // per item, or later chapters would have nothing to choose from.
  const seen = new Set<string>();
  for (const chapter of chapters) {
    for (const itemId of chapter.itemIds) {
      const key = `${chapter.index}:${itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const asset: any = assets.get(itemId);
      if (!asset) continue;
      if (asset.kind === 'photo') {
        out.push({ candidateId: `${itemId}#still@c${chapter.index}`, itemId, kind: 'photo', chapterIndex: chapter.index, minHoldSec: holds.min, maxHoldSec: holds.max, description: asset.analysis?.caption || asset.file || itemId });
        continue;
      }
      const shots: Shot[] = (asset.analysis?.shots || []).filter((s: Shot) => s.usable !== false);
      const transcript: Segment[] = asset.analysis?.transcript || [];
      const ranked = shots.map((shot, index) => ({ shot, index })).sort((a, b) => (b.shot.quality || 0) - (a.shot.quality || 0));
      let added = 0;
      for (const { shot, index } of ranked) {
        for (const range of legalRanges(shot, transcript, holds.max * 2)) {
          if (added >= perItem) break;
          out.push({
            candidateId: `${itemId}#s${index}@${range.inSec}c${chapter.index}`,
            itemId,
            kind: 'video',
            chapterIndex: chapter.index,
            inSec: range.inSec,
            outSec: range.outSec,
            lengthSec: Number((range.outSec - range.inSec).toFixed(2)),
            hasSpeech: range.hasSpeech,
            description: `${shot.role === 'A_ROLL' ? 'speech to camera: ' : ''}${shot.description || ''}`.slice(0, 160),
          });
          added++;
        }
        if (added >= perItem) break;
      }
    }
  }
  return out;
}
