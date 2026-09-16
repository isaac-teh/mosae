// Composition: code offers legal clips, the model arranges them.
// Earlier versions asked the model for raw timestamps and it produced ranges that
// spanned shots, cut sentences, or repeated an item. Those failures are arithmetic,
// so candidates.ts precomputes valid clips and the model only picks order, holds,
// transitions and overlays.
import path from 'node:path';
import { generate, json, parseArgs, runDir, save } from './common.js';
import { models } from './config.js';
import { craftBrief, holdsFor } from './editCraft.js';
import { buildCandidates, type Candidate } from './candidates.js';
import { z } from 'zod';

const { set, model = models.compose } = parseArgs();
const catalogAt = process.argv.indexOf('--catalog');
const catalogModel = catalogAt >= 0 ? process.argv[catalogAt + 1] : models.analyze;
if (!set) throw new Error('Usage: 05-compose.ts <set> [--model id] [--catalog id]');

const catalog: any = await json(path.join(runDir(set, catalogModel), 'catalog.json'));
const proposal: any = await json(path.join(runDir(set, models.story), 'story.json'));
const assets = new Map<string, any>(catalog.items.map((x: any) => [x.id, x]));
const chapters = proposal.chapters.map((chapter: any, index: number) => ({ index, title: chapter.title, purpose: chapter.purpose, itemIds: chapter.itemIds.map((item: any) => item.id) }));
const holds = holdsFor(proposal.musicMood || '');
const target = proposal.targetDurationSec;

const candidates = buildCandidates(chapters, assets, holds);
const byId = new Map(candidates.map(c => [c.candidateId, c]));

const schema = {
  type: 'object',
  properties: {
    clips: { type: 'array', items: { type: 'object', properties: { candidateId: { type: 'string' }, holdSec: { type: 'number' }, transition: { type: 'string', enum: ['cut', 'crossfade', 'dip'] }, textOverlay: { type: 'string' }, audio: { type: 'string', enum: ['keep', 'duck', 'mute'] } }, required: ['candidateId', 'transition', 'audio'] } },
    musicCues: { type: 'array', items: { type: 'object', properties: { atSec: { type: 'number' }, cue: { type: 'string' } }, required: ['atSec', 'cue'] } },
  },
  required: ['clips', 'musicCues'],
};
const Z = z.object({
  clips: z.array(z.object({ candidateId: z.string(), holdSec: z.number().optional(), transition: z.enum(['cut', 'crossfade', 'dip']), textOverlay: z.string().optional(), audio: z.enum(['keep', 'duck', 'mute']) })),
  musicCues: z.array(z.object({ atSec: z.number(), cue: z.string() })),
});

// Turn the model's picks into the timeline, dropping anything unusable rather than
// trusting it: unknown ids, the same clip twice, and more than MAX_PER_ITEM clips
// from one source. A long interview legitimately supplies several clips, so the
// limit is per clip rather than per item.
const MAX_PER_ITEM = 3;
function assemble(picks: z.infer<typeof Z>) {
  const usedCandidates = new Set<string>();
  const perItem = new Map<string, number>();
  const clips: any[] = [];
  const dropped: string[] = [];
  for (const pick of picks.clips) {
    const candidate = byId.get(pick.candidateId);
    if (!candidate) { dropped.push(`unknown candidate ${pick.candidateId}`); continue; }
    if (usedCandidates.has(candidate.candidateId)) { dropped.push(`repeat of clip ${candidate.candidateId}`); continue; }
    const used = perItem.get(candidate.itemId) || 0;
    if (used >= MAX_PER_ITEM) { dropped.push(`${candidate.itemId}: more than ${MAX_PER_ITEM} clips`); continue; }
    if (clips.at(-1)?.itemId === candidate.itemId && candidate.kind === 'photo') { dropped.push(`${candidate.itemId}: same still twice in a row`); continue; }
    usedCandidates.add(candidate.candidateId);
    perItem.set(candidate.itemId, used + 1);
    const base = { itemId: candidate.itemId, order: clips.length + 1, transition: pick.transition, audio: pick.audio, ...(pick.textOverlay ? { textOverlay: pick.textOverlay } : {}) };
    clips.push(candidate.kind === 'photo'
      ? { ...base, holdSec: Math.min(holds.max, Math.max(holds.min, pick.holdSec ?? holds.base ?? 3)) }
      : { ...base, sourceInSec: candidate.inSec, sourceOutSec: candidate.outSec, hasSpeech: candidate.hasSpeech });
  }
  return { clips, dropped };
}

const lengthOf = (clip: any) => clip.holdSec ?? (clip.sourceOutSec - clip.sourceInSec);

// Fit to target by stretching or trimming photo holds only; video ranges stay legal.
function fitDuration(clips: any[]) {
  const notes: string[] = [];
  const photos = clips.filter(c => c.holdSec != null);
  for (let pass = 0; pass < 20; pass++) {
    const total = clips.reduce((sum, c) => sum + lengthOf(c), 0);
    const drift = total - target;
    if (Math.abs(drift) <= target * 0.05) break;
    const room = photos.filter(c => drift > 0 ? c.holdSec > holds.min : c.holdSec < holds.max);
    if (!room.length) {
      // Out of photo slack: when too long, trim silent video clips from their tail.
      // Shortening keeps a range inside its shot, and speech clips are never touched.
      if (drift > 0) {
        let excess = drift;
        for (const clip of [...clips].reverse()) {
          if (excess <= 0.01 || clip.sourceOutSec == null || clip.hasSpeech) continue;
          const spare = (clip.sourceOutSec - clip.sourceInSec) - 1.5;
          const cut = Math.min(spare, excess);
          if (cut <= 0) continue;
          clip.sourceOutSec = Number((clip.sourceOutSec - cut).toFixed(2));
          excess -= cut;
        }
        notes.push(`trimmed silent video by ${(drift - excess).toFixed(1)}s`);
      } else notes.push(`photo holds exhausted at ${total.toFixed(1)}s`);
      break;
    }
    const step = drift / room.length;
    for (const photo of room) photo.holdSec = Number(Math.min(holds.max, Math.max(holds.min, photo.holdSec - step)).toFixed(2));
  }
  return notes;
}

function validate(clips: any[]) {
  const errors: string[] = [];
  const total = clips.reduce((sum, c) => sum + lengthOf(c), 0);
  const chapterOf = new Map(candidates.map(c => [c.itemId, c.chapterIndex]));
  let previous = -1;
  const covered = new Set<number>();
  for (const clip of clips) {
    const chapter = chapterOf.get(clip.itemId);
    if (chapter == null) { errors.push(`${clip.itemId}: not a proposal item`); continue; }
    covered.add(chapter);
    if (chapter < previous) errors.push(`${clip.itemId}: out of chapter order`);
    previous = Math.max(previous, chapter);
  }
  for (const chapter of chapters) if (!covered.has(chapter.index)) errors.push(`chapter ${chapter.index + 1} (${chapter.title}) has no clip`);
  if (Math.abs(total - target) > target * 0.1) errors.push(`duration ${total.toFixed(1)} not within 10% of ${target}`);
  return { pass: !errors.length, errors, totalDurationSec: Number(total.toFixed(2)) };
}

const brief = `${craftBrief(proposal.musicMood || '', target)}

You are choosing from clips that are already legal: every video range sits inside one shot and never cuts a sentence. Do not invent timestamps.

Rules:
- Pick candidateIds in the order they should play, following chapter order. A source item may appear up to ${MAX_PER_ITEM} times, but only through different candidates.
- Every chapter must contribute at least one clip.
- For photo candidates give holdSec between ${holds.min} and ${holds.max}. Video clip length is fixed by the candidate.
- Aim for a total near ${target}s; small drift is corrected afterwards by adjusting photo holds.

Chapters: ${JSON.stringify(chapters.map((c: any) => ({ index: c.index, title: c.title, purpose: c.purpose })))}
Candidates: ${JSON.stringify(candidates)}`;

const dir = runDir(set, model);
let picks = await generate({ dir, stage: 'compose', model, contents: brief, schema, validate: x => Z.parse(x) });
let { clips, dropped } = assemble(picks);
let fitNotes = fitDuration(clips);
let result = validate(clips);
const attempts = [{ attempt: 1, clips: clips.length, videoClips: clips.filter(c => c.sourceOutSec != null).length, pass: result.pass, errors: result.errors, dropped }];

for (let repair = 0; repair < 1 && !result.pass; repair++) {
  picks = await generate({ dir, stage: 'compose', model, contents: `${brief}\n\nYour previous selection failed these checks: ${result.errors.join('; ')}${dropped.length ? `; ignored picks: ${dropped.join('; ')}` : ''}. Return a corrected selection.`, schema, validate: x => Z.parse(x) });
  ({ clips, dropped } = assemble(picks));
  fitNotes = fitDuration(clips);
  result = validate(clips);
  attempts.push({ attempt: repair + 2, clips: clips.length, videoClips: clips.filter(c => c.sourceOutSec != null).length, pass: result.pass, errors: result.errors, dropped });
}

const timeline = { clips: clips.map(({ hasSpeech, ...clip }) => clip), musicCues: picks.musicCues };
await save(path.join(dir, 'timeline.json'), timeline);
await save(path.join(dir, 'validation.json'), { ...result, repairCount: attempts.length - 1, selectedClipShare: 1, proposalSelectedItemCount: new Set(candidates.map(c => c.itemId)).size, candidateCount: candidates.length, fitNotes, modelAttempts: attempts });
console.log(`Timeline ${result.pass ? 'PASS' : 'FAIL'} (${result.totalDurationSec}s, ${clips.length} clips, ${clips.filter(c => c.sourceOutSec != null).length} video) from ${candidates.length} candidates${result.errors.length ? `: ${result.errors.join('; ')}` : ''}`);
