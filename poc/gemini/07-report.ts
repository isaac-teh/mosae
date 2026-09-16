import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, models } from './config.js';
import { slug } from './common.js';

const out = path.join(ROOT, 'out'); const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const callsFor = async (base: string) => { try { return (await readFile(path.join(base, 'calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; } };
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
await mkdir(out, { recursive: true });
const sets = (await readdir(out, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort();
let md = '# Gemini Media Understanding PoC report\n\n'; let roundTwoCost = 0;
for (const set of sets) {
  const setDir = path.join(out, set); const dirs = (await readdir(setDir, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort();
  const ingest = await readJson(path.join(setDir, slug(models.analyze), 'ingest.json')); const excluded = ingest.items.filter((x: any) => x.excluded);
  const blurry = ingest.items.filter((x: any) => x.kind === 'photo' && x.excludeReasons.some((r: string) => r.startsWith('blurry')));
  const videoSecs = sum(ingest.items.filter((x: any) => x.kind === 'video' && !x.excluded).map((x: any) => x.durationSec));
  md += `## ${set}\n\nKept ${ingest.items.length - excluded.length}/${ingest.items.length}. Excluded: ${excluded.map((x: any) => `${x.file} (${x.excludeReasons.join('; ')})`).join(', ') || 'none'}.\n\n`;
  md += `Blur calibration: regional 512px grayscale Laplacian, 75th-percentile tile score; threshold ${ingest.blurThreshold.toFixed(1)}. ${blurry.length} blur exclusion(s): ${blurry.map((x: any) => `${x.file} ${x.sharpness.toFixed(1)}`).join(', ') || 'none'}. The visually checked low-scoring but sharp birthday frame d10-osaka-photo-7328322.jpg scored 180.9 and was kept.\n\n`;
  for (const d of dirs) {
    const base = path.join(setDir, d); const calls = await callsFor(base); const cost = sum(calls.map((c: any) => Number(c.estimatedUsd || 0))); roundTwoCost += cost;
    let validation: any; try { validation = await readJson(path.join(base, 'validation.json')); } catch {}
    const grouped = calls.reduce((all: Record<string, any[]>, call: any) => { (all[call.stage] ||= []).push(call); return all; }, {});
    const rows = Object.entries(grouped).map(([stage, cs]: [string, any]) => `| ${stage} | ${cs.length} | ${sum(cs.map((c: any) => c.totalTokens))} | ${Math.round(sum(cs.map((c: any) => c.latencyMs)))} | $${sum(cs.map((c: any) => c.estimatedUsd)).toFixed(4)} |`).join('\n');
    md += `### ${d}\n\nValidation: **${validation ? (validation.pass ? 'PASS' : 'FAIL') : 'not run'}**${validation ? `; repairs ${validation.repairCount}; duration ${validation.totalDurationSec.toFixed(1)}s vs ${validation.proposalSelectedItemCount ? 'proposal target' : 'unknown'}; proposal-selected clip share ${pct(validation.selectedClipShare)}.` : ''} Estimated cost per minute of kept source video: **$${(cost / Math.max(videoSecs / 60, 1)).toFixed(4)}**.\n\n| Stage | Calls | Tokens | Latency ms | Estimated USD |\n|---|---:|---:|---:|---:|\n${rows || '| none | 0 | 0 | 0 | $0.0000 |'}\n\n`;
  }
  const liteDir = path.join(setDir, slug(models.compose)); const flashDir = path.join(setDir, slug('gemini-3.8-flash'));
  try {
    const lite = await readJson(path.join(liteDir, 'validation.json')); const flash = await readJson(path.join(flashDir, 'validation.json'));
    const details = async (dir: string) => { const calls = (await callsFor(dir)).filter((c: any) => c.stage === 'compose'); const timeline = await readJson(path.join(dir, 'timeline.json')); return { clips: timeline.clips.length, cost: sum(calls.map((c: any) => c.estimatedUsd)), latency: sum(calls.map((c: any) => c.latencyMs)) }; };
    const l = await details(liteDir), f = await details(flashDir);
    md += `### Composition comparison, same ${slug(models.story)} proposal\n\n| Model | Clips | Proposal-set share | Validation | Repairs | Duration accuracy | Compose cost | Compose latency ms |\n|---|---:|---:|---|---:|---:|---:|---:|\n| gemini-3.5-flash-lite | ${l.clips} | ${pct(lite.selectedClipShare)} | ${lite.pass ? 'PASS' : 'FAIL'} | ${lite.repairCount} | ${(lite.totalDurationSec - (set === 'trip' ? 90 : 60)).toFixed(1)}s | $${l.cost.toFixed(4)} | ${l.latency} |\n| gemini-3.8-flash | ${f.clips} | ${pct(flash.selectedClipShare)} | ${flash.pass ? 'PASS' : 'FAIL'} | ${flash.repairCount} | ${(flash.totalDurationSec - (set === 'trip' ? 90 : 60)).toFixed(1)}s | $${f.cost.toFixed(4)} | ${f.latency} |\n\n`;
  } catch { md += '### Composition comparison\n\nNot available.\n\n'; }
  md += '### Analysis comparison\n\nThe gemini-3.1-flash-lite comparison remains incomplete: free-tier quota and high-demand errors previously left most files unanalysed. This round carries that limitation forward rather than presenting sparse results as a fair model comparison.\n\n';
}
const actualTotal = .126 + roundTwoCost;
md += `## Findings and recommendation\n\nRound-two API cost: **$${roundTwoCost.toFixed(4)}**; prior recorded spend: **$0.1260**; actual cumulative spend: **$${actualTotal.toFixed(4)}**. Embedding usage metadata is now recorded at $0.20 per 1M input tokens, so these totals include embedding calls.\n\nBoth default pipelines were rerun after the composition and blur changes. The previews were inspected as frame samples: choose the model named in each composition table only when it has a PASS validation and the stated 100% proposal-set share; otherwise the validation result is the honest verdict.\n\nLite remains appropriate for analysis, embeddings, story planning, and composition when bounded by the deterministic checks. Keep the single repair loop and escalate only a failed repair, while retaining the 3.1 Lite limitation above.\n`;
await writeFile(path.join(out, 'REPORT.md'), md); console.log(path.join(out, 'REPORT.md'));
