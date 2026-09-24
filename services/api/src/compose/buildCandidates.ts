/**
 * Build every legal clip candidate before the model chooses.
 * The model picks illegal ranges on its own: spanning two shots or slicing a sentence in half.
 * Those are arithmetic, not taste — code does them here and the model only selects and orders what is already valid.
 */

export interface Candidate {
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
}

export interface Shot {
  startSec: number;
  endSec: number;
  description?: string;
  role?: string;
  quality?: number;
  usable?: boolean;
}

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface AssetAnalysis {
  shots?: Shot[];
  transcript?: TranscriptSegment[];
  caption?: string;
}

export interface Asset {
  kind: 'photo' | 'video';
  analysis?: AssetAnalysis;
  file?: string;
  keyMomentScore?: number;
}

export interface ChapterCandidateInput {
  index: number;
  itemIds: string[];
}

const MIN_CLIP = 1.2;
const HANDLE = 0.15; // leave room at each end so a crossfade has something to work with

/**
 * A range is legal when it sits inside one shot and does not start or end inside speech.
 */
function legalRanges(shot: Shot, transcript: TranscriptSegment[], maxLen: number): Array<{ inSec: number; outSec: number; hasSpeech: boolean }> {
  const inside = transcript.filter(s => s.endSec > shot.startSec && s.startSec < shot.endSec).sort((a, b) => a.startSec - b.startSec);
  const ranges: Array<{ inSec: number; outSec: number; hasSpeech: boolean }> = [];

  // Whole speech segments, clamped to the shot, keep a sentence intact.
  for (const segment of inside) {
    const inSec = Math.max(shot.startSec, segment.startSec);
    let outSec = Math.min(shot.endSec, segment.endSec);
    if (outSec - inSec >= MIN_CLIP) ranges.push({ inSec: Number(inSec.toFixed(2)), outSec: Number(outSec.toFixed(2)), hasSpeech: true });
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

/**
 * Build candidates per chapter, not once per item.
 * A story may place the same item in several chapters (a long interview often is the spine of the whole piece),
 * so later chapters would have nothing to choose from if we only built once.
 */
export function buildCandidates(
  chapters: ChapterCandidateInput[],
  assets: Map<string, Asset>,
  holds: { min: number; max: number },
  perItem = 6,
): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();

  for (const chapter of chapters) {
    for (const itemId of chapter.itemIds) {
      const key = `${chapter.index}:${itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const asset: Asset | undefined = assets.get(itemId);
      if (!asset) continue;

      if (asset.kind === 'photo') {
        out.push({
          candidateId: `${itemId}#still@c${chapter.index}`,
          itemId,
          kind: 'photo',
          chapterIndex: chapter.index,
          minHoldSec: holds.min,
          maxHoldSec: holds.max,
          description: asset.analysis?.caption || asset.file || itemId,
        });
        continue;
      }

      const shots: Shot[] = (asset.analysis?.shots || []).filter((s: Shot) => s.usable !== false);
      const transcript: TranscriptSegment[] = asset.analysis?.transcript || [];
      const ranked = shots.map((shot, index) => ({ shot, index })).sort((a, b) => (b.shot.quality || 0) - (a.shot.quality || 0));

      let added = 0;
      for (const { shot } of ranked) {
        for (const range of legalRanges(shot, transcript, holds.max * 2)) {
          if (added >= perItem) break;
          out.push({
            candidateId: `${itemId}#s${shots.indexOf(shot)}@${range.inSec}c${chapter.index}`,
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
