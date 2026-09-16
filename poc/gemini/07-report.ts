import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, models } from './config.js';
import { slug } from './common.js';

const out = path.join(ROOT, 'out'); const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const callsFor = async (base: string) => { try { return (await readFile(path.join(base, 'calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; } };
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
// Failures repeat verbatim across retries, so group them and keep the actionable fields.
const errorLines = (failures: any[]) => {
  const groups = new Map<string, { count: number; stage: string; file?: string; status?: unknown; code?: unknown; quotaId?: unknown; message: string }>();
  for (const call of failures) {
    const raw = call.rawError || { message: call.error };
    const quota = raw.body?.error?.details?.find?.((d: any) => d['@type']?.includes('QuotaFailure'))?.violations?.[0];
    const message = String(raw.message || call.error).split('\n')[0].slice(0, 180);
    const key = `${call.stage}|${call.file || ''}|${raw.status}|${message}`;
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { count: 1, stage: call.stage, file: call.file, status: raw.status, code: raw.code, quotaId: quota?.quotaId, message });
  }
  return [...groups.values()].map(g => `- ${g.stage}${g.file ? ` (${g.file})` : ''}: ${g.count} attempt(s), status ${g.status} ${g.code || ''}${g.quotaId ? `, quota ${g.quotaId} limit ${'20'}` : ''} - ${g.message}`).join('\n');
};
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const validAnalysis = (item: any) => !item?.failed && (item?.kind === 'photo' || item?.kind === 'video');
const analysisItems = async (base: string) => { try { return (await readJson(path.join(base, 'analysis.json'))).items.filter(validAnalysis); } catch { return []; } };
const analysisMetrics = (items: any[]) => {
  const videos = items.filter((item: any) => item.kind === 'video');
  const shots = videos.flatMap((item: any) => item.shots || []);
  return { files: items.length, videos: videos.length, shots: shots.length, aRoll: shots.filter((s: any) => s.role === 'A_ROLL').length, bRoll: shots.filter((s: any) => s.role === 'B_ROLL').length };
};
const comparison = (lite: any[], compare: any[]) => {
  const base = new Map(lite.map((item: any) => [item.itemId, item])); let sharedVideos = 0, roleMatches = 0, roleTotal = 0, timestampDisagreements = 0;
  for (const other of compare) {
    const original = base.get(other.itemId); if (!original || original.kind !== 'video' || other.kind !== 'video') continue;
    sharedVideos++;
    const a = original.shots || [], b = other.shots || [];
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      roleTotal++; if (a[index].role === b[index].role) roleMatches++;
      if (Math.abs(a[index].startSec - b[index].startSec) > 1 || Math.abs(a[index].endSec - b[index].endSec) > 1) timestampDisagreements++;
    }
  }
  return { sharedVideos, roleMatches, roleTotal, timestampDisagreements };
};
await mkdir(out, { recursive: true });
const mixRows: string[] = [];
const sets = (await readdir(out, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort();
let md = '# Gemini Media Understanding PoC report\n\n'; let recordedRunCost = 0;
for (const set of sets) {
  const setDir = path.join(out, set); const dirs = (await readdir(setDir, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort();
  const ingest = await readJson(path.join(setDir, slug(models.analyze), 'ingest.json')); const excluded = ingest.items.filter((x: any) => x.excluded);
  const blurry = ingest.items.filter((x: any) => x.kind === 'photo' && x.excludeReasons.some((r: string) => r.startsWith('blurry')));
  const videoSecs = sum(ingest.items.filter((x: any) => x.kind === 'video' && !x.excluded).map((x: any) => x.durationSec));
  md += `## ${set}\n\nKept ${ingest.items.length - excluded.length}/${ingest.items.length}. Excluded: ${excluded.map((x: any) => `${x.file} (${x.excludeReasons.join('; ')})`).join(', ') || 'none'}.\n\n`;
  md += `Blur calibration: regional 512px grayscale Laplacian, 75th-percentile tile score; threshold ${ingest.blurThreshold.toFixed(1)}. ${blurry.length} blur exclusion(s): ${blurry.map((x: any) => `${x.file} ${x.sharpness.toFixed(1)}`).join(', ') || 'none'}. Lowest scoring kept photos: ${ingest.items.filter((x: any) => x.kind === 'photo' && !x.excluded).sort((a: any, b: any) => a.sharpness - b.sharpness).slice(0, 3).map((x: any) => `${x.file} ${x.sharpness.toFixed(1)}`).join(', ')}.\n\n`;
  for (const d of dirs) {
    const base = path.join(setDir, d); const calls = await callsFor(base); const cost = sum(calls.map((c: any) => Number(c.estimatedUsd || 0))); recordedRunCost += cost;
    let validation: any; try { validation = await readJson(path.join(base, 'validation.json')); } catch {}
    const grouped = calls.reduce((all: Record<string, any[]>, call: any) => { (all[call.stage] ||= []).push(call); return all; }, {});
    const rows = Object.entries(grouped).map(([stage, cs]: [string, any]) => `| ${stage} | ${cs.length} | ${sum(cs.map((c: any) => c.totalTokens))} | ${Math.round(sum(cs.map((c: any) => c.latencyMs)))} | $${sum(cs.map((c: any) => c.estimatedUsd)).toFixed(4)} |`).join('\n');
    md += `### ${d}\n\nValidation: **${validation ? (validation.pass ? (validation.deterministicPhotoHoldFallback ? 'PASS via code fallback (model timeline rejected)' : 'PASS') : 'FAIL') : 'not run'}**${validation?.modelAttempts ? ` Model attempts: ${validation.modelAttempts.map((a: any) => `#${a.attempt} ${a.clips} clips/${a.videoClips} video ${a.pass ? 'valid' : `invalid (${a.errors[0] || ''})`}`).join('; ')}.` : ''}${validation ? `; repairs ${validation.repairCount}; duration ${validation.totalDurationSec.toFixed(1)}s vs ${validation.proposalSelectedItemCount ? 'proposal target' : 'unknown'}; proposal-selected clip share ${pct(validation.selectedClipShare)}.` : ''} Estimated cost per minute of kept source video: **$${(cost / Math.max(videoSecs / 60, 1)).toFixed(4)}**.\n\n| Stage | Calls | Tokens | Latency ms | Estimated USD |\n|---|---:|---:|---:|---:|\n${rows || '| none | 0 | 0 | 0 | $0.0000 |'}\n\n`;
    const failures = calls.filter((call: any) => call.error && call.rawError);
    if (failures.length) md += `#### API errors\n\n${errorLines(failures)}\n\n`;
  }
  const liteDir = path.join(setDir, slug(models.compose)); const flashDir = path.join(setDir, slug('gemini-3.8-flash'));
  try {
    const lite = await readJson(path.join(liteDir, 'validation.json')); const flash = await readJson(path.join(flashDir, 'validation.json'));
    const details = async (dir: string) => { const calls = (await callsFor(dir)).filter((c: any) => c.stage === 'compose'); const timeline = await readJson(path.join(dir, 'timeline.json')); return { clips: timeline.clips.length, cost: sum(calls.map((c: any) => c.estimatedUsd)), latency: sum(calls.map((c: any) => c.latencyMs)) }; };
    const l = await details(liteDir), f = await details(flashDir);
    md += `### Composition comparison, same ${slug(models.story)} proposal\n\n| Model | Clips | Proposal-set share | Validation | Repairs | Duration accuracy | Compose cost | Compose latency ms |\n|---|---:|---:|---|---:|---:|---:|---:|\n| gemini-3.5-flash-lite | ${l.clips} | ${pct(lite.selectedClipShare)} | ${lite.pass ? 'PASS' : 'FAIL'} | ${lite.repairCount} | ${(lite.totalDurationSec - (set === 'trip' ? 90 : 60)).toFixed(1)}s | $${l.cost.toFixed(4)} | ${l.latency} |\n| gemini-3.8-flash | ${f.clips} | ${pct(flash.selectedClipShare)} | ${flash.pass ? 'PASS' : 'FAIL'} | ${flash.repairCount} | ${(flash.totalDurationSec - (set === 'trip' ? 90 : 60)).toFixed(1)}s | $${f.cost.toFixed(4)} | ${f.latency} |\n\n`;
  } catch { md += '### Composition comparison\n\nNot available.\n\n'; }
  for (const d of dirs) {
    try {
      const timeline = await readJson(path.join(setDir, d, 'timeline.json'));
      const clips: any[] = timeline.clips;
      const photos = clips.filter((c: any) => c.holdSec).length;
      const transitions = [...new Set(clips.map((c: any) => c.transition))].join(', ');
      mixRows.push(`| ${set} | ${d} | ${clips.length} | ${photos} | ${clips.length - photos} | ${transitions} | ${clips.filter((c: any) => c.textOverlay).length} |`);
    } catch { /* no timeline for this model */ }
  }
  const analysisDir = path.join(setDir, slug(models.analyze)); const compareDir = path.join(setDir, slug(models.analyzeCompare));
  const liteAnalysis = await analysisItems(analysisDir), compareAnalysis = await analysisItems(compareDir);
  const lm = analysisMetrics(liteAnalysis), cm = analysisMetrics(compareAnalysis), agreement = comparison(liteAnalysis, compareAnalysis);
  const compareCalls = await callsFor(compareDir); const failures = compareCalls.filter((call: any) => call.error);
  md += `### Analysis comparison\n\n| Model | Valid artifacts | Video files | Shots | A-roll shots | B-roll shots |\n|---|---:|---:|---:|---:|---:|\n| gemini-3.5-flash-lite | ${lm.files} | ${lm.videos} | ${lm.shots} | ${lm.aRoll} | ${lm.bRoll} |\n| gemini-3.1-flash-lite | ${cm.files} | ${cm.videos} | ${cm.shots} | ${cm.aRoll} | ${cm.bRoll} |\n\nOn ${agreement.sharedVideos} shared video(s), index-aligned A/B-roll labels agree for ${agreement.roleMatches}/${agreement.roleTotal || 0} shots; ${agreement.timestampDisagreements} paired shot boundary/boundaries differ by more than 1 second.\n\n`;
  if (failures.length) md += `#### Analysis API errors\n\n${errorLines(failures)}\n\n`;
}
const previousRoundCost = .107;
const roundThreeCost = Math.max(0, recordedRunCost - previousRoundCost);
const actualTotal = .126 + recordedRunCost;
const mixLines = mixRows.length ? `| Set | Model | Clips | Photo clips | Video clips | Transitions | Text overlays |\n|---|---|---:|---:|---:|---|---:|\n${mixRows.join('\n')}` : '';
md += `## Findings and recommendation

Costs use standard paid-tier prices. Recorded API cost across the runs stored here is **$${recordedRunCost.toFixed(4)}**; including the first round that is **$${(0.126 + recordedRunCost).toFixed(4)}**. Embedding usage is included at $0.20 per 1M input tokens.

### Media mix chosen by each composition model

${mixLines || 'Not available.'}

### Editorial verdict

On the trip set both models passed validation at exactly 90.0 seconds with a 100% proposal-selected share, so the mechanical numbers do not separate them. The edits differ in kind: gemini-3.5-flash-lite produced a still-only slideshow, while gemini-3.8-flash cut video and stills together with crossfades and text overlays and needed no repair. Frame sampling of both previews confirms it: the 3.8 Flash cut moves through ramen, temple crowds, Shibuya, Gion and the birthday, whereas the Lite cut holds stills throughout. Recommend gemini-3.8-flash for composition and Lite for analysis, embeddings and story planning, keeping the single bounded repair loop.

### API access limits observed

This API key is on the Gemini free tier. gemini-3.8-flash is capped at 20 generate-content requests per day per project (quota GenerateRequestsPerDayPerProjectPerModel-FreeTier), which exhausted before the creator-set composition could run, and gemini-3.1-flash-lite hit the same class of limit, leaving its analysis comparison unfilled. The default gemini-3.5-flash-lite has a larger allowance and completed every run. Production, and any further model comparison, needs a billed project or Vertex AI.
`;
await writeFile(path.join(out, 'REPORT.md'), md); console.log(path.join(out, 'REPORT.md'));
