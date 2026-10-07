import { bestWindow } from "./videoWindow.js";

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
  windowScore?: number;
  highlightScore?: number;
  loudPeak?: number;
  description: string;
}

export interface Shot {
  startSec: number;
  endSec: number;
  description?: string;
  role?: string;
  quality?: number;
  usable?: boolean;
  highlights?: { startSec: number; endSec: number; label?: string; score: number }[];
  signals?: { stepSec: number; shake: number[]; blur: number[]; loud: number[] };
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
  assetId?: string;
  eventId?: string | null;
  localTime?: string | null;
  dHash?: string | null;
  dupOf?: string | null;
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
  cadence?: import("@mosae/contracts").CadenceId,
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

      if (cadence) {
        const targets: Record<typeof cadence, [number, number]> = { tender: [4, 6], reflective: [4, 6], playful: [2, 3], energetic: [2, 3], celebratory: [3, 4] };
        const [minLength, maxLength] = targets[cadence];
        let added = 0;
        for (const { shot } of ranked) {
          const duration = shot.endSec - shot.startSec;
          if (!Number.isFinite(shot.startSec) || !Number.isFinite(shot.endSec) || !Number.isFinite(duration) || duration <= 0) continue;
          const speechInShot = transcript.filter(s => s.endSec > shot.startSec && s.startSec < shot.endSec);
          const lengths: number[] = [];
          if (duration < 4) lengths.push(duration);
          else for (let len = Math.min(maxLength, duration); len >= Math.min(minLength, duration); len = Number((len - 0.25).toFixed(2))) lengths.push(len);
          const window = lengths.map(len => bestWindow(shot, len, { speech: speechInShot })).filter((v): v is NonNullable<typeof v> => Boolean(v)).sort((a, b) => b.score - a.score || (a.outSec - a.inSec) - (b.outSec - b.inSec) || a.inSec - b.inSec)[0];
          if (!window) continue;
          const hasSpeech = speechInShot.some(s => s.startSec >= window.inSec - 0.01 && s.endSec <= window.outSec + 0.01);
          const score = window.score;
          const highlightScore = Math.max(0, ...(shot.highlights ?? []).filter(h => h.endSec > window.inSec && h.startSec < window.outSec).map(h => h.score));
          const signalStep = shot.signals?.stepSec ?? 0.25;
          const loudPeak = Math.max(0, ...(shot.signals?.loud ?? []).filter((_, i) => shot.startSec + i * signalStep < window.outSec && shot.startSec + (i + 1) * signalStep > window.inSec));
          out.push({ candidateId: `${itemId}#s${shots.indexOf(shot)}@${window.inSec}c${chapter.index}`, itemId, kind: 'video', chapterIndex: chapter.index, inSec: window.inSec, outSec: window.outSec, lengthSec: Number((window.outSec - window.inSec).toFixed(2)), hasSpeech, windowScore: score, highlightScore, loudPeak, description: `${shot.role === 'A_ROLL' ? 'speech to camera: ' : ''}${shot.description || ''}`.slice(0, 160) });
          if (++added >= perItem) break;
        }
        continue;
      }

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

  if (!cadence) return out;

  // A source video can contribute at most one shot. Keep its strongest window,
  // with stable earliest/ID tie breaks, regardless of how many moments name it.
  const videoBySource = new Map<string, Candidate[]>();
  const retained: Candidate[] = [];
  for (const candidate of out) {
    if (candidate.kind !== 'video') { retained.push(candidate); continue; }
    const sourceId = assets.get(candidate.itemId)?.assetId ?? candidate.itemId;
    const group = videoBySource.get(sourceId) ?? [];
    group.push(candidate);
    videoBySource.set(sourceId, group);
  }
  for (const group of videoBySource.values()) {
    group.sort((a, b) => (b.windowScore ?? 0) - (a.windowScore ?? 0) || (a.inSec ?? 0) - (b.inSec ?? 0) || a.candidateId.localeCompare(b.candidateId));
    retained.push(group[0]!);
  }
  return retained.sort((a, b) => a.chapterIndex - b.chapterIndex || a.itemId.localeCompare(b.itemId) || (a.inSec ?? 0) - (b.inSec ?? 0));
}
