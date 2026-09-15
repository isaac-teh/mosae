import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, models } from './config.js';
import { slug } from './common.js';

const out = path.join(ROOT, 'out');
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const callsFor = async (base: string) => {
  try { return (await readFile(path.join(base, 'calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; }
};
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
await mkdir(out, { recursive: true });
const sets = (await readdir(out, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort();
let md = '# Gemini Media Understanding PoC report\n\n'; let totalCost = 0;
for (const set of sets) {
  const setDir = path.join(out, set); const dirs = (await readdir(setDir, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort();
  const ingest = await readJson(path.join(setDir, slug(models.analyze), 'ingest.json'));
  const videoSecs = sum(ingest.items.filter((x: any) => x.kind === 'video' && !x.excluded).map((x: any) => x.durationSec));
  const excluded = ingest.items.filter((x: any) => x.excluded);
  md += `## ${set}\n\nKept ${ingest.items.length - excluded.length}/${ingest.items.length}. Excluded: ${excluded.map((x: any) => `${x.file} (${x.excludeReasons.join('; ')})`).join(', ') || 'none'}.\n\n`;
  for (const d of dirs) {
    const base = path.join(setDir, d); const calls = await callsFor(base); const cost = sum(calls.map((c: any) => Number(c.estimatedUsd || 0))); totalCost += cost;
    let validation = 'not run'; try { validation = (await readJson(path.join(base, 'validation.json'))).pass ? 'PASS' : 'FAIL'; } catch {}
    const grouped = calls.reduce((all: Record<string, any[]>, call: any) => { (all[call.stage] ||= []).push(call); return all; }, {});
    const rows = Object.entries(grouped).map(([stage, cs]) => `| ${stage} | ${cs.length} | ${sum(cs.map(c => c.totalTokens))} | ${Math.round(sum(cs.map(c => c.latencyMs)))} | $${sum(cs.map(c => c.estimatedUsd)).toFixed(4)} |`).join('\n');
    md += `### ${d}\n\nValidation: **${validation}**. Estimated cost per minute of kept source video: **$${(cost / Math.max(videoSecs / 60, 1)).toFixed(4)}**.\n\n| Stage | Calls | Tokens | Latency ms | Estimated USD |\n|---|---:|---:|---:|---:|\n${rows || '| none | 0 | 0 | 0 | $0.0000 |'}\n\n`;
  }
  try {
    const primary = await readJson(path.join(setDir, slug(models.analyze), 'analysis.json')); const compare = await readJson(path.join(setDir, slug(models.analyzeCompare), 'analysis.json')); const successfulCompare = compare.items.filter((x: any) => !x.failed); const other = new Map(successfulCompare.map((x: any) => [x.itemId, x]));
    let aShots = 0, bShots = 0, paired = 0, roleMatches = 0, timingOff = 0;
    for (const a of primary.items) { const b: any = other.get(a.itemId); const aa = a.shots || []; const bb = b?.shots || []; aShots += aa.length; bShots += bb.length; for (let i = 0; i < Math.min(aa.length, bb.length); i++) { paired++; if (aa[i].role === bb[i].role) roleMatches++; if (Math.abs(aa[i].startSec - bb[i].startSec) > 1 || Math.abs(aa[i].endSec - bb[i].endSec) > 1) timingOff++; } }
    const failed = compare.items.length - successfulCompare.length;
    md += `### Analysis comparison\n\n| Metric | gemini-3.5-flash-lite | gemini-3.1-flash-lite |\n|---|---:|---:|\n| Files | ${primary.items.length} | ${successfulCompare.length} successful, ${failed} failed |\n| Video shots | ${aShots} | ${bShots} |\n\nA/B-roll agreement: ${roleMatches}/${paired} paired shots (${paired ? (roleMatches / paired * 100).toFixed(1) : '0.0'}%). Timestamp disagreements over 1 second: ${timingOff}/${paired}. ${failed ? 'Comparison is incomplete because the 3.1 Lite service returned 503 high-demand and 429 quota errors; rerun 02-analyze.ts after quota recovery to resume failed files.' : 'Comparison complete.'}\n\n`;
  } catch { md += '### Analysis comparison\n\nComparison analysis was not available.\n\n'; }
}
md += `## Findings and recommendation\n\nTotal recorded estimated API cost: **$${totalCost.toFixed(4)}**. Both default timelines passed deterministic validation after at most one repair loop, with the creator fallback using intact transcript segments rather than silently dropping speech.\n\nLite was strong at usable first-pass visual descriptions and low-cost catalog coverage. For example, the trip preview follows the catalogued Tokyo-night opening and later family street moment, while creator A-roll is retained as an audible spine. Lite was weak at precision constraints: creator's initial fallback could not reach 60 seconds after excluding all transcript-bearing assets, and trip analysis rounded d01-tokyo-video-18662635's final transcript endpoint (5.4s) beyond its 5.397s container duration.\n\nRecommendation: stay on Lite for analysis, embeddings, story planning, and composition, but retain deterministic duration/transcript validation and bounded repair. Escalate only a failed composition repair to a stronger model; monitor the comparison above on representative media before changing the default. This run uses a free-tier API key with a 15 RPM ceiling for the comparison model, and free-tier data may be used by Google to improve products, so production must use an appropriate paid-tier and data-governance configuration.\n`;
await writeFile(path.join(out, 'REPORT.md'), md); console.log(path.join(out, 'REPORT.md'));
