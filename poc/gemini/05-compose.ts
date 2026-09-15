import path from 'node:path';
import { generate, json, parseArgs, runDir, save } from './common.js';
import { models } from './config.js';
import { z } from 'zod';
const { set, model = models.compose } = parseArgs(); if (!set) throw new Error('Usage: 05-compose.ts <set> [--model id]'); const catalog: any = await json(path.join(runDir(set), 'catalog.json')); const proposal: any = await json(path.join(runDir(set, model), 'story.json')); const assets = new Map(catalog.items.map((x: any) => [x.id, x]));
const schema = { type: 'object', properties: { clips: { type: 'array', items: { type: 'object', properties: { itemId: { type: 'string' }, sourceInSec: { type: 'number' }, sourceOutSec: { type: 'number' }, holdSec: { type: 'number' }, order: { type: 'integer' }, transition: { type: 'string', enum: ['cut','crossfade','dip'] }, textOverlay: { type: 'string' }, audio: { type: 'string', enum: ['keep','duck','mute'] } }, required: ['itemId','order','transition','audio'] } }, musicCues: { type: 'array', items: { type: 'object', properties: { atSec: { type: 'number' }, cue: { type: 'string' } }, required: ['atSec','cue'] } } }, required: ['clips','musicCues'] };
const Z = z.object({ clips: z.array(z.object({ itemId: z.string(), sourceInSec: z.number().optional(), sourceOutSec: z.number().optional(), holdSec: z.number().optional(), order: z.number().int(), transition: z.enum(['cut','crossfade','dip']), textOverlay: z.string().optional(), audio: z.enum(['keep','duck','mute']) })), musicCues: z.array(z.object({ atSec: z.number(), cue: z.string() })) });
function validate(t: z.infer<typeof Z>) { const errors: string[] = []; let total = 0; for (const c of t.clips) { const a: any = assets.get(c.itemId); if (!a) { errors.push(`unknown id ${c.itemId}`); continue; } if (a.kind === 'photo') { if (!c.holdSec || c.holdSec < 1.5 || c.holdSec > 5) errors.push(`${c.itemId}: invalid photo hold`); total += c.holdSec || 0; } else { if (c.sourceInSec == null || c.sourceOutSec == null || c.sourceInSec < 0 || c.sourceOutSec <= c.sourceInSec || c.sourceOutSec > a.durationSec) errors.push(`${c.itemId}: invalid source range`); else { const shots = a.analysis?.shots || []; if (!shots.some((s: any) => c.sourceInSec! >= s.startSec - .05 && c.sourceOutSec! <= s.endSec + .05)) errors.push(`${c.itemId}: range outside analyzed shot`); const segs = a.analysis?.transcript || []; if (segs.some((s: any) => c.sourceInSec! > s.startSec && c.sourceInSec! < s.endSec || c.sourceOutSec! > s.startSec && c.sourceOutSec! < s.endSec)) errors.push(`${c.itemId}: cuts transcript segment`); total += c.sourceOutSec - c.sourceInSec; } } } if (Math.abs(total - proposal.targetDurationSec) > proposal.targetDurationSec * .1) errors.push(`duration ${total.toFixed(1)} not within 10% of ${proposal.targetDurationSec}`); return { pass: !errors.length, errors, totalDurationSec: total }; }
const prompt = `Compose a precise timeline from this proposal and catalog. Keep all cuts inside described video shots, keep transcript segments intact, photo holds 1.5-5 seconds, and target ${proposal.targetDurationSec}s. Proposal: ${JSON.stringify(proposal)} Catalog: ${catalog.items.map((x: any) => ({ id:x.id,kind:x.kind,durationSec:x.durationSec,analysis:x.analysis })).map(JSON.stringify).join('\n')}`;
let timeline: any; let validation: any; for (let attempt = 0; attempt < 2; attempt++) { timeline = await generate({ dir: runDir(set, model), stage: 'compose', model, contents: attempt ? `${prompt}\nRepair these deterministic validation errors: ${validation.errors.join('; ')}` : prompt, schema, validate: x => Z.parse(x) }); validation = validate(timeline); if (validation.pass) break; }
if (!validation.pass) {
  // A transcript makes arbitrary slices invalid, but it does not make an A-roll
  // asset unusable.  The prior fallback skipped every such asset, leaving the
  // creator run with only 32 seconds of B-roll.  Use complete transcript
  // segments that are contained in an analysed shot, then fill with B-roll.
  const clips: any[] = []; let order = 1, total = 0;
  const add = (a: any, start: number, end: number, audio: 'keep' | 'mute') => {
    if (end <= start || total >= proposal.targetDurationSec) return;
    clips.push({ itemId: a.id, sourceInSec: start, sourceOutSec: end, order: order++, transition: 'cut', audio });
    total += end - start;
  };
  for (const a of catalog.items) {
    if (a.kind !== 'video') continue;
    const shots = a.analysis?.shots || [];
    for (const segment of a.analysis?.transcript || []) {
      // Do not trim a rounded transcript endpoint to the container duration:
      // that would itself create a mid-segment cut.  Skip it and let another
      // intact segment or visual clip fill the duration instead.
      const insideShot = segment.startSec >= 0 && segment.endSec <= a.durationSec && shots.some((s: any) => segment.startSec >= s.startSec - .05 && segment.endSec <= s.endSec + .05);
      if (insideShot) add(a, segment.startSec, segment.endSec, 'keep');
      if (total >= proposal.targetDurationSec * .75) break;
    }
    if (total >= proposal.targetDurationSec * .75) break;
  }
  for (const a of catalog.items) {
    if (a.kind === 'photo' && total < proposal.targetDurationSec) {
      const holdSec = Math.min(3, proposal.targetDurationSec - total);
      if (holdSec >= 1.5) { clips.push({ itemId: a.id, holdSec, order: order++, transition: 'cut', audio: 'mute' }); total += holdSec; }
    } else if (a.kind === 'video' && !(a.analysis?.transcript?.length) && total < proposal.targetDurationSec) {
      for (const s of a.analysis?.shots || []) {
        const length = Math.min(4, s.endSec - s.startSec, proposal.targetDurationSec - total);
        if (length >= 1) add(a, s.startSec, s.startSec + length, 'mute');
        if (total >= proposal.targetDurationSec) break;
      }
    }
    if (total >= proposal.targetDurationSec) break;
  }
  timeline = { clips, musicCues: [] }; validation = validate(timeline); validation.fallback = true;
}
await save(path.join(runDir(set, model), 'timeline.json'), timeline); await save(path.join(runDir(set, model), 'validation.json'), validation); console.log(`Timeline validation: ${validation.pass ? 'PASS' : 'FAIL'} (${validation.totalDurationSec.toFixed(1)}s)`);
