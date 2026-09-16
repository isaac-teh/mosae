import path from 'node:path';
import { generate, json, parseArgs, runDir, save } from './common.js';
import { defaultIntents, models, targetDuration } from './config.js';
import { z } from 'zod';
const args = process.argv.slice(2); const { set, model = models.story } = parseArgs(args); if (!set) throw new Error('Usage: 04-story.ts <set> "intent" [--model id]'); const intent = args.find(x => x.startsWith('This ') || x.startsWith('Make ')) || defaultIntents[set];
const catalog: any = await json(path.join(runDir(set), 'catalog.json')); const ids = new Set(catalog.items.map((x: any) => x.id));
const schema = { type: 'object', properties: { title: { type: 'string' }, logline: { type: 'string' }, targetDurationSec: { type: 'number' }, chapters: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, purpose: { type: 'string' }, itemIds: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id','reason'] } } }, required: ['title','purpose','itemIds'] } }, openingItemId: { type: 'string' }, closingItemId: { type: 'string' }, musicMood: { type: 'string' }, excludedHighlights: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id','reason'] } }, openQuestions: { type: 'array', items: { type: 'string' } } }, required: ['title','logline','targetDurationSec','chapters','openingItemId','closingItemId','musicMood','excludedHighlights','openQuestions'] };
const Z = z.object({ title: z.string(), logline: z.string(), targetDurationSec: z.number(), chapters: z.array(z.object({ title: z.string(), purpose: z.string(), itemIds: z.array(z.object({ id: z.string(), reason: z.string() })) })), openingItemId: z.string(), closingItemId: z.string(), musicMood: z.string(), excludedHighlights: z.array(z.object({ id: z.string(), reason: z.string() })), openQuestions: z.array(z.string()) });
const prompt = `Create a bounded story proposal for ${targetDuration[set]} seconds. Intent: ${intent}
Select enough distinct items to actually sustain the target: a photo can contribute only about 3 seconds (at most 5), while a video contributes only its usable analyzed-shot length. For ${targetDuration[set]} seconds, select roughly ${Math.ceil(targetDuration[set] / 3)} photo-equivalents unless usable video duration replaces them. Put every selected id in chapters in intended chronological chapter order; opening and closing must also be chapter selections. Do not select decorative extras that the composition will not use.
Each chapter must draw on its own material: give every chapter at least two items, and do not build the whole piece from one file even when that file is long. When the catalog has both speech-to-camera (A_ROLL) and cutaway (B_ROLL) footage, a talking head should carry the story while B-roll from other files illustrates what is being said, so select B-roll items alongside the speech.
Catalog (only these ids may be used):\n${catalog.items.map((x: any) => x.text).join('\n')}`;
const validate = (x: unknown) => { const r = Z.parse(x); for (const id of [r.openingItemId, r.closingItemId, ...r.chapters.flatMap(c => c.itemIds.map(i => i.id)), ...r.excludedHighlights.map(x => x.id)]) if (!ids.has(id)) throw new Error(`Unknown catalog id ${id}`);
  // A plan built from one file cannot become an edit, so reject it here and let the retry fix it.
  const distinct = new Set(r.chapters.flatMap(c => c.itemIds.map(i => i.id)));
  if (r.chapters.some(c => new Set(c.itemIds.map(i => i.id)).size < 2)) throw new Error('Every chapter needs at least two distinct items');
  if (distinct.size < Math.min(ids.size, r.chapters.length + 2)) throw new Error(`Only ${distinct.size} distinct items across ${r.chapters.length} chapters`);
  // When the catalog holds speech to camera, the plan must use some of it: the talking head is the spine.
  const speaking = new Set(catalog.items.filter((x: any) => (x.analysis?.shots || []).some((sh: any) => sh.role === 'A_ROLL') && (x.analysis?.transcript || []).length >= 3).map((x: any) => x.id));
  if (speaking.size && ![...distinct].some(id => speaking.has(id))) throw new Error(`No speech-to-camera item selected; use at least one of ${[...speaking].slice(0, 6).join(', ')} as the spine`);
  return r; };
let proposal: z.infer<typeof Z>; let last: unknown;
for (let attempt = 0; attempt < 2; attempt++) try { proposal = await generate({ dir: runDir(set, model), stage: 'story', model, contents: attempt ? `${prompt}\nYour last response failed a check: ${String((last as any)?.message || last)}. Retry using only literal catalog ids and fix that problem.` : prompt, schema, validate }); break; } catch (error) { last = error; }
if (!proposal!) throw last;
await save(path.join(runDir(set, model), 'story.json'), proposal); console.log(`Story: ${proposal.title}`);
