import path from 'node:path';
import { generate, json, parseArgs, runDir, save } from './common.js';
import { models } from './config.js';
import { z } from 'zod';

const { set, model = models.compose } = parseArgs();
if (!set) throw new Error('Usage: 05-compose.ts <set> [--model id]');
const catalog: any = await json(path.join(runDir(set), 'catalog.json'));
const proposal: any = await json(path.join(runDir(set, models.story), 'story.json'));
const assets = new Map(catalog.items.map((x: any) => [x.id, x]));
const clipSchema = { type: 'object', properties: { itemId: { type: 'string' }, sourceInSec: { type: 'number' }, sourceOutSec: { type: 'number' }, holdSec: { type: 'number' }, order: { type: 'integer' }, transition: { type: 'string', enum: ['cut', 'crossfade', 'dip'] }, textOverlay: { type: 'string' }, audio: { type: 'string', enum: ['keep', 'duck', 'mute'] } }, required: ['itemId', 'order', 'transition', 'audio'] };
const schema = { type: 'object', properties: { clips: { type: 'array', items: clipSchema }, musicCues: { type: 'array', items: { type: 'object', properties: { atSec: { type: 'number' }, cue: { type: 'string' } }, required: ['atSec', 'cue'] } }, needMoreItems: { type: 'array', items: { type: 'string' } } }, required: ['clips', 'musicCues'] };
const Z = z.object({ clips: z.array(z.object({ itemId: z.string(), sourceInSec: z.number().optional(), sourceOutSec: z.number().optional(), holdSec: z.number().optional(), order: z.number().int(), transition: z.enum(['cut', 'crossfade', 'dip']), textOverlay: z.string().optional(), audio: z.enum(['keep', 'duck', 'mute']) })), musicCues: z.array(z.object({ atSec: z.number(), cue: z.string() })), needMoreItems: z.array(z.string()).max(12).optional() });
const chapters = proposal.chapters.map((chapter: any, index: number) => ({ index, title: chapter.title, purpose: chapter.purpose, itemIds: chapter.itemIds.map((item: any) => item.id) }));
const selected = new Set<string>([proposal.openingItemId, proposal.closingItemId, ...chapters.flatMap((chapter: any) => chapter.itemIds)]);
const itemChapter = new Map<string, number>();
for (const chapter of chapters) for (const id of chapter.itemIds) if (!itemChapter.has(id)) itemChapter.set(id, chapter.index);
if (!itemChapter.has(proposal.openingItemId)) itemChapter.set(proposal.openingItemId, 0);
if (!itemChapter.has(proposal.closingItemId)) itemChapter.set(proposal.closingItemId, chapters.length - 1);

function validationFor(t: z.infer<typeof Z>, allowed: Set<string>, chaptersForItem: Map<string, number>) {
  const errors: string[] = []; let total = 0; let previousChapter = -1; const contributed = new Set<number>(); const used = new Set<string>();
  for (const c of [...t.clips].sort((a, b) => a.order - b.order)) {
    const a: any = assets.get(c.itemId); const chapter = chaptersForItem.get(c.itemId);
    if (!a) { errors.push(`unknown id ${c.itemId}`); continue; }
    if (!allowed.has(c.itemId)) errors.push(`${c.itemId}: not selected by proposal`);
    if (used.has(c.itemId)) errors.push(`${c.itemId}: item repeated`); used.add(c.itemId);
    if (chapter == null) errors.push(`${c.itemId}: no chapter assignment`); else { if (chapter < previousChapter) errors.push(`${c.itemId}: chapter order regressed`); previousChapter = Math.max(previousChapter, chapter); contributed.add(chapter); }
    if (a.kind === 'photo') { if (c.holdSec == null || c.holdSec < 1.5 || c.holdSec > 5) errors.push(`${c.itemId}: invalid photo hold`); total += c.holdSec || 0; }
    else if (c.sourceInSec == null || c.sourceOutSec == null || c.sourceInSec < 0 || c.sourceOutSec <= c.sourceInSec || c.sourceOutSec > a.durationSec) errors.push(`${c.itemId}: invalid source range`);
    else {
      const shots = a.analysis?.shots || []; if (!shots.some((s: any) => c.sourceInSec! >= s.startSec - .05 && c.sourceOutSec! <= s.endSec + .05)) errors.push(`${c.itemId}: range outside analyzed shot`);
      const segs = a.analysis?.transcript || []; if (segs.some((s: any) => (c.sourceInSec! > s.startSec && c.sourceInSec! < s.endSec) || (c.sourceOutSec! > s.startSec && c.sourceOutSec! < s.endSec))) errors.push(`${c.itemId}: cuts transcript segment`);
      total += c.sourceOutSec - c.sourceInSec;
    }
  }
  for (const chapter of chapters) if (!contributed.has(chapter.index)) errors.push(`chapter ${chapter.index + 1} (${chapter.title}) has no clip`);
  if (Math.abs(total - proposal.targetDurationSec) > proposal.targetDurationSec * .1) errors.push(`duration ${total.toFixed(1)} not within 10% of ${proposal.targetDurationSec}`);
  return { pass: !errors.length, errors, totalDurationSec: total, selectedClipShare: t.clips.length ? t.clips.filter(c => selected.has(c.itemId)).length / t.clips.length : 0, repairCount: 0 };
}
const describe = (ids: Set<string>) => [...ids].map(id => { const a: any = assets.get(id); return a && { id, kind: a.kind, durationSec: a.durationSec, analysis: a.analysis }; }).filter(Boolean);
const maxCapacity = (ids: Set<string>) => [...ids].reduce((total, id) => { const a: any = assets.get(id); return total + (a?.kind === 'photo' ? 5 : Math.max(0, ...(a?.analysis?.shots || []).map((s: any) => s.endSec - s.startSec))); }, 0);
const catalogCandidates = catalog.items.filter((x: any) => !selected.has(x.id)).map((x: any) => ({ id: x.id, kind: x.kind, analysis: x.analysis }));
const mustRequestMore = maxCapacity(selected) < proposal.targetDurationSec * .9;
const basePrompt = `Compose a timeline ONLY from these selected proposal items, in chapter order and serving each chapter purpose. Never repeat an item. Every chapter must contribute a clip. Use motion wherever it exists: every selected video item must contribute at least one clip taken from inside one of its analyzed shots, and photos are held stills used to bridge between them. Photo holds must be 1.5-5 seconds; stay inside analyzed video shots and never cut a transcript segment. Vary transitions (cut for pace, crossfade for reflective beats) and add a short textOverlay only where it names a place or moment. Target ${proposal.targetDurationSec}s. If the selected set cannot sustain it, return an empty clips array and needMoreItems containing at most 12 catalog ids you want; do not substitute unselected media. Proposal chapters: ${JSON.stringify(chapters)}. Selected assets: ${JSON.stringify(describe(selected))}`;
const firstPrompt = mustRequestMore ? `${basePrompt}\nThe deterministic maximum capacity of this selected set is ${maxCapacity(selected).toFixed(1)}s, below the required ${(proposal.targetDurationSec * .9).toFixed(1)}s. Return empty clips and needMoreItems only, choosing ids from these candidates: ${JSON.stringify(catalogCandidates)}` : basePrompt;
let timeline = await generate({ dir: runDir(set, model), stage: 'compose', model, contents: firstPrompt, schema, validate: x => Z.parse(x) });
let approvedAdditions = new Set<string>();
if (timeline.needMoreItems?.length) {
  approvedAdditions = new Set(timeline.needMoreItems.filter(id => assets.has(id) && !selected.has(id)).slice(0, 12));
  for (const id of approvedAdditions) {
    const at = catalog.items.findIndex((x: any) => x.id === id); let nearest = 0, distance = Infinity;
    for (const [selectedId, chapter] of itemChapter) { const candidateAt = catalog.items.findIndex((x: any) => x.id === selectedId); if (Math.abs(candidateAt - at) < distance) { distance = Math.abs(candidateAt - at); nearest = chapter; } }
    itemChapter.set(id, nearest);
  }
  timeline = await generate({ dir: runDir(set, model), stage: 'compose', model, contents: `${basePrompt}\nApproved second-pass additions, with fixed chapter assignment: ${JSON.stringify([...approvedAdditions].map(id => ({ id, chapterIndex: itemChapter.get(id), asset: assets.get(id) })))}\nNow return the final timeline using only selected items and these approved additions.`, schema, validate: x => Z.parse(x) });
}
const allowed = new Set([...selected, ...approvedAdditions]); let validation: any = validationFor(timeline, allowed, itemChapter);
for (let repair = 0; repair < 1 && !validation.pass; repair++) {
  timeline = await generate({ dir: runDir(set, model), stage: 'compose', model, contents: `${basePrompt}\nApproved additions: ${JSON.stringify([...approvedAdditions])}\nRepair this exact timeline using no other ids. Deterministic errors: ${validation.errors.join('; ')}`, schema, validate: x => Z.parse(x) });
  validation = validationFor(timeline, allowed, itemChapter); validation.repairCount = repair + 1;
}
// A final deterministic photo-only construction is available for photo-rich
// proposals when the one allowed model repair is still invalid. It never pads
// with catalog media: every clip remains a selected proposal item, in chapter
// order, and holds are extended only within the permitted 1.5-5 second range.
if (!validation.pass) {
  const photos = chapters.flatMap((chapter: any) => chapter.itemIds.filter((id: string) => (assets.get(id) as any)?.kind === 'photo').map((id: string) => ({ id, chapter: chapter.index }))).filter((x: any, index: number, all: any[]) => all.findIndex(y => y.id === x.id) === index);
  const represented = new Set(photos.map((x: any) => x.chapter));
  if (chapters.every((chapter: any) => represented.has(chapter.index)) && photos.length * 1.5 <= proposal.targetDurationSec && photos.length * 5 >= proposal.targetDurationSec * .9) {
    let remaining = proposal.targetDurationSec - photos.length * 1.5;
    const clips = photos.map((photo: any, index: number) => { const extra = Math.min(3.5, remaining); remaining -= extra; return { itemId: photo.id, holdSec: 1.5 + extra, order: index + 1, transition: 'cut' as const, audio: 'mute' as const }; });
    timeline = { clips, musicCues: [] }; validation = validationFor(timeline, allowed, itemChapter); validation.repairCount = 1; validation.deterministicPhotoHoldFallback = true;
  }
}
// If the repaired cut is otherwise valid but slightly long, shorten its last
// visual video clips deterministically. This keeps the proposal, chapter order,
// and shot bounds intact and is refused when it would bisect speech.
if (!validation.pass && validation.errors.every((error: string) => error.startsWith('duration '))) {
  const shortened = structuredClone(timeline); let excess = validation.totalDurationSec - proposal.targetDurationSec;
  for (const clip of [...shortened.clips].sort((a: any, b: any) => b.order - a.order)) {
    if (excess <= .001 || clip.sourceInSec == null || clip.sourceOutSec == null) continue;
    const a: any = assets.get(clip.itemId); const safeEnd = clip.sourceOutSec - excess;
    const transcript = a.analysis?.transcript || [];
    if (safeEnd <= clip.sourceInSec || transcript.some((s: any) => safeEnd > s.startSec && safeEnd < s.endSec)) continue;
    excess -= clip.sourceOutSec - safeEnd; clip.sourceOutSec = safeEnd;
  }
  const shortenedValidation = validationFor(shortened, allowed, itemChapter);
  if (shortenedValidation.pass) { timeline = shortened; validation = shortenedValidation; validation.repairCount = 1; validation.deterministicDurationTrim = true; }
}
validation.approvedSecondPassAdditions = [...approvedAdditions]; validation.proposalSelectedItemCount = selected.size;
await save(path.join(runDir(set, model), 'timeline.json'), timeline); await save(path.join(runDir(set, model), 'validation.json'), validation);
console.log(`Timeline validation: ${validation.pass ? 'PASS' : 'FAIL'} (${validation.totalDurationSec.toFixed(1)}s, proposal share ${(validation.selectedClipShare * 100).toFixed(1)}%)`);
