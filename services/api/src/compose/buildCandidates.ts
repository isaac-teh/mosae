import { bestWindow, scoreWindow } from "./videoWindow.js";
import { DIRECTING_RULES, videoTargetLength } from "./directingRules.js";

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
  /** Complete transcript segments covered by this legal source window. */
  speechSegments?: TranscriptSegment[];
  windowScore?: number;
  highlightScore?: number;
  quality?: number;
  emotion?: number;
  storyRole?: "opener" | "peak" | "closer" | "normal";
  energy?: number;
  /** Additional strong beat from a source after one primary clip is represented. */
  isExtraMoment?: boolean;
  loudPeak?: number;
  description: string;
}

export interface Shot {
  startSec: number;
  endSec: number;
  description?: string;
  role?: string;
  emotion?: string;
  emotionScore?: number;
  storyRole?: "opener" | "peak" | "closer" | "normal";
  subjects?: string[];
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
  setting?: string;
  mood?: string;
  activities?: string[];
  shotType?: string;
  aesthetics?: number;
  keyMomentScore?: number;
  storyRole?: "opener" | "peak" | "closer" | "normal";
  emotionScore?: number;
}

export interface Asset {
  kind: 'photo' | 'video';
  width?: number;
  height?: number;
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

const MIN_CLIP = DIRECTING_RULES.videoMinClipSec;
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

function deviation(values: number[]): number {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function isSameScene(shots: Shot[]): boolean {
  if (shots.length !== 1) return false;
  const shot = shots[0]!;
  if ((shot.highlights ?? []).some((highlight) => highlight.score >= DIRECTING_RULES.videoHighlightBoundaryMin)) return false;
  const signals = shot.signals;
  if (!signals) return false;
  return deviation(signals.shake) <= DIRECTING_RULES.sameSceneMaxMotionStdDev && deviation(signals.loud) <= DIRECTING_RULES.sameSceneMaxLoudnessStdDev;
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
          quality: asset.analysis?.aesthetics !== undefined ? asset.analysis.aesthetics / 5 : asset.analysis?.keyMomentScore !== undefined ? asset.analysis.keyMomentScore / 5 : undefined,
          emotion: asset.analysis?.emotionScore ?? (asset.analysis?.mood ? (/joy|happy|smil|laugh|love|warm|tender|celebrat/i.test(asset.analysis.mood) ? 0.85 : /calm|peace|gentle|quiet/i.test(asset.analysis.mood) ? 0.65 : undefined) : undefined),
          storyRole: asset.analysis?.storyRole,
          energy: (asset.analysis?.activities ?? []).some((activity) => /run|dance|jump|play|splash|race|cheer|laugh/i.test(activity)) ? 0.75 : undefined,
          description: [asset.analysis?.caption, asset.analysis?.setting, asset.analysis?.mood, ...(asset.analysis?.activities ?? [])].filter(Boolean).join(". ") || asset.file || itemId,
        });
        continue;
      }

      const shots: Shot[] = (asset.analysis?.shots || []).filter((s: Shot) => s.usable !== false);
      const transcript: TranscriptSegment[] = asset.analysis?.transcript || [];
      const sameScene = isSameScene(shots);
      const ranked = shots.map((shot, index) => ({ shot, index })).sort((a, b) => (b.shot.quality || 0) - (a.shot.quality || 0));

      if (cadence) {
        const targets: Record<typeof cadence, [number, number]> = { tender: [4, 6], reflective: [4, 6], playful: [2, 3], energetic: [2, 3], celebratory: [3, 4] };
        const [minLength, maxLength] = targets[cadence];
        let added = 0;
        for (const { shot } of ranked) {
          const duration = shot.endSec - shot.startSec;
          if (!Number.isFinite(shot.startSec) || !Number.isFinite(shot.endSec) || !Number.isFinite(duration) || duration <= 0) continue;
          const speechInShot = transcript.filter(s => s.endSec > shot.startSec && s.startSec < shot.endSec);
          const probe = bestWindow(shot, Math.min(maxLength, duration), { speech: speechInShot });
          const target = sameScene ? Math.min(DIRECTING_RULES.videoMinClipSec, duration) : Math.max(Math.min(DIRECTING_RULES.videoMinClipSec, duration), videoTargetLength(cadence, duration, probe?.score ?? 0));
          let window = bestWindow(shot, target, { speech: speechInShot });
          // A scoring window can straddle one edge of a transcript segment.
          // When it does, use the complete sentence as the candidate, provided
          // it fits the directing rule's eight-second speech allowance.
          if (window) {
            const splitSegments = speechInShot.filter(s =>
              window!.inSec > s.startSec + 0.15 && window!.inSec < s.endSec - 0.15
              || window!.outSec > s.startSec + 0.15 && window!.outSec < s.endSec - 0.15);
            const complete = splitSegments
              .filter(s => s.startSec >= shot.startSec - 0.01 && s.endSec <= shot.endSec + 0.01 && s.endSec - s.startSec <= 8)
              .sort((a, b) => (b.endSec - b.startSec) - (a.endSec - a.startSec))[0];
            if (complete) window = { inSec: complete.startSec, outSec: complete.endSec, score: scoreWindow(shot, complete.startSec, complete.endSec) };
          }
          if (!window) continue;
          const hasSpeech = speechInShot.some(s => s.startSec >= window.inSec - 0.01 && s.endSec <= window.outSec + 0.01);
          const score = window.score;
          const highlightScore = Math.max(0, ...(shot.highlights ?? []).filter(h => h.endSec > window.inSec && h.startSec < window.outSec).map(h => h.score));
          const signalStep = shot.signals?.stepSec ?? 0.25;
          const loudPeak = Math.max(0, ...(shot.signals?.loud ?? []).filter((_, i) => shot.startSec + i * signalStep < window.outSec && shot.startSec + (i + 1) * signalStep > window.inSec));
          out.push({ candidateId: `${itemId}#s${shots.indexOf(shot)}@${window.inSec}c${chapter.index}`, itemId, kind: 'video', chapterIndex: chapter.index, inSec: window.inSec, outSec: window.outSec, lengthSec: Number((window.outSec - window.inSec).toFixed(2)), hasSpeech, speechSegments: speechInShot.filter(s => s.startSec >= window.inSec - 0.01 && s.endSec <= window.outSec + 0.01), windowScore: score, highlightScore, loudPeak, quality: shot.quality, emotion: shot.emotionScore ?? (shot.emotion ? (/joy|happy|smil|laugh|love|warm|tender|celebrat/i.test(shot.emotion) ? 0.85 : /calm|peace|gentle|quiet/i.test(shot.emotion) ? 0.65 : undefined) : undefined), storyRole: shot.storyRole, energy: Math.max(highlightScore, score), description: `${shot.role === 'A_ROLL' ? 'speech to camera: ' : ''}${shot.description || ''}`.slice(0, 160) });
          if (sameScene) { added++; break; }
          // Emit other explicitly strong, distinct moments from the same shot.
          // Signals alone can select the primary window, but never authorize extras.
          for (const highlight of (shot.highlights ?? []).filter((h) => h.score >= 0.7)) {
            if (out.filter((c) => c.itemId === itemId && c.chapterIndex === chapter.index && c.kind === 'video').length >= perItem) break;
            const extraLength = Math.max(Math.min(DIRECTING_RULES.videoMinClipSec, duration), videoTargetLength(cadence, duration, highlight.score));
            const center = (Math.max(shot.startSec, highlight.startSec) + Math.min(shot.endSec, highlight.endSec)) / 2;
            const extraIn = Math.max(shot.startSec + 0.15, Math.min(shot.endSec - 0.15 - extraLength, center - extraLength / 2));
            const extraOut = extraIn + extraLength;
            if (!(extraOut > extraIn) || speechInShot.some((s) => (extraIn > s.startSec + 0.01 && extraIn < s.endSec - 0.01) || (extraOut > s.startSec + 0.01 && extraOut < s.endSec - 0.01))) continue;
            if (Math.max(0, Math.max(extraIn, window.inSec) - Math.min(extraOut, window.outSec)) < 3) continue;
            const extraScore = scoreWindow(shot, extraIn, extraOut);
            out.push({ candidateId: `${itemId}#s${shots.indexOf(shot)}@${extraIn.toFixed(2)}c${chapter.index}`, itemId, kind: 'video', chapterIndex: chapter.index, inSec: Number(extraIn.toFixed(2)), outSec: Number(extraOut.toFixed(2)), lengthSec: Number(extraLength.toFixed(2)), hasSpeech: false, speechSegments: [], windowScore: extraScore, highlightScore: highlight.score, isExtraMoment: true, loudPeak: 0, description: `${shot.description || ''}`.slice(0, 160) });
          }
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
            speechSegments: range.hasSpeech ? transcript.filter(s => s.startSec >= range.inSec - 0.01 && s.endSec <= range.outSec + 0.01) : [],
            description: `${shot.role === 'A_ROLL' ? 'speech to camera: ' : ''}${shot.description || ''}`.slice(0, 160),
          });
          added++;
        }
        if (added >= perItem) break;
      }
    }
  }

  if (!cadence) return out;

  // Keep distinct strong highlights per source video, with chronological separation.
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
    const asset = assets.get(group[0]!.itemId);
    const sourceDuration = Math.max(0, ...(asset?.analysis?.shots ?? []).map((shot) => shot.endSec));
    const maxClips = sourceDuration >= 30 ? 3 : sourceDuration >= 12 ? 2 : 1;
    const chosen: Candidate[] = [];
    for (const candidate of group) {
      if (chosen.length >= maxClips) break;
      if (chosen.length && (candidate.highlightScore ?? 0) < 0.7) continue;
      if (chosen.some((other) => Math.max(0, Math.max(candidate.inSec ?? 0, other.inSec ?? 0) - Math.min(candidate.outSec ?? 0, other.outSec ?? 0)) < 3)) continue;
      chosen.push(candidate);
    }
    retained.push(...chosen);
  }
  return retained.sort((a, b) => a.chapterIndex - b.chapterIndex || a.itemId.localeCompare(b.itemId) || (a.inSec ?? 0) - (b.inSec ?? 0));
}
