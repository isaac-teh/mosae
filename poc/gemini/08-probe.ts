// Single-file model probe. Runs ONE photo and ONE video through each candidate model
// using the production prompt and schema, so quality and cost can be judged before
// paying for a full run. Writes out/probe/analyze.md and raw JSON per model.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { AnalysisSchema, cleanupUploads, generate, mimeFor, sampleDir, save, slug, uploadVideo } from './common.js';
import { probeModels, ROOT } from './config.js';

const args = process.argv.slice(2);
const at = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const photo = at('--photo') ?? 'trip/d03-tokyo-photo-37478100.jpg';
const video = at('--video') ?? 'trip/d02-tokyo-video-31387250.mp4';
const only = at('--models')?.split(',');
const list = only ?? [...probeModels];
const dir = path.join(ROOT, 'out', 'probe');

const photoSchema = { type: 'object', properties: { kind: { type: 'string', enum: ['photo'] }, caption: { type: 'string' }, subjects: { type: 'array', items: { type: 'object', properties: { peopleCount: { type: 'integer' }, roles: { type: 'array', items: { type: 'string' } }, attributes: { type: 'array', items: { type: 'string' } } }, required: ['peopleCount', 'roles', 'attributes'] } }, setting: { type: 'string' }, activities: { type: 'array', items: { type: 'string' } }, mood: { type: 'string' }, shotType: { type: 'string' }, aesthetics: { type: 'number', minimum: 1, maximum: 5 }, keyMomentScore: { type: 'number', minimum: 1, maximum: 5 }, tags: { type: 'array', items: { type: 'string' } } }, required: ['kind', 'caption', 'subjects', 'setting', 'activities', 'mood', 'shotType', 'aesthetics', 'keyMomentScore', 'tags'] };
const videoSchema = { type: 'object', properties: { kind: { type: 'string', enum: ['video'] }, shots: { type: 'array', items: { type: 'object', properties: { startSec: { type: 'number' }, endSec: { type: 'number' }, shotType: { type: 'string' }, camera: { type: 'string' }, role: { type: 'string', enum: ['A_ROLL', 'B_ROLL'] }, description: { type: 'string' }, subjects: { type: 'array', items: { type: 'string' } }, emotion: { type: 'string' }, quality: { type: 'number', minimum: 1, maximum: 5 }, usable: { type: 'boolean' }, reason: { type: 'string' } }, required: ['startSec', 'endSec', 'shotType', 'camera', 'role', 'description', 'subjects', 'emotion', 'quality', 'usable', 'reason'] } }, transcript: { type: 'array', items: { type: 'object', properties: { startSec: { type: 'number' }, endSec: { type: 'number' }, text: { type: 'string' } }, required: ['startSec', 'endSec', 'text'] } }, bestMomentSec: { type: 'number' } }, required: ['kind', 'shots', 'transcript', 'bestMomentSec'] };

const photoPrompt = 'Analyze this photo for a family-memory shot catalog. Do not identify people by name. Be concise and only describe visible evidence.';
const videoPromptFor = (seconds: number) => `Analyze this video at low resolution. Segment every meaningful shot, identify A_ROLL only when speech-to-camera carries the story, transcribe audible speech with timestamps, and keep timestamps within duration ${seconds.toFixed(2)} seconds.`;

const photoPath = path.join(sampleDir(photo.split('/')[0]), path.basename(photo));
const videoPath = path.join(sampleDir(video.split('/')[0]), path.basename(video));
const { stdout: durationOut } = await import('node:child_process').then(cp => new Promise<{ stdout: string }>((resolve, reject) => cp.execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath], (e, stdout) => e ? reject(e) : resolve({ stdout }))));
const videoSeconds = Number(durationOut.trim());

const remoteNames: string[] = [];
const { remote } = await uploadVideo(videoPath);
if (remote.name) remoteNames.push(remote.name);
const photoBytes = (await readFile(photoPath)).toString('base64');

type Row = { model: string; kind: string; ok: boolean; note: string; tokens: number; usd: number; ms: number };
const rows: Row[] = [];

async function run(model: string, kind: 'photo' | 'video') {
  const contents = kind === 'photo'
    ? [{ text: photoPrompt }, { inlineData: { mimeType: mimeFor(photoPath), data: photoBytes } }]
    : [{ text: videoPromptFor(videoSeconds) }, { fileData: { fileUri: remote.uri, mimeType: remote.mimeType } }];
  const before = await callCount(model);
  try {
    const value: any = await generate({ dir: path.join(dir, slug(model)), stage: `probe-${kind}`, model, file: kind === 'photo' ? path.basename(photoPath) : path.basename(videoPath), contents, schema: kind === 'photo' ? photoSchema : videoSchema, validate: x => AnalysisSchema.parse(x), thinking: true });
    await save(path.join(dir, slug(model), `${kind}.json`), value);
    const note = kind === 'photo'
      ? `${value.caption} | shot ${value.shotType} | mood ${value.mood} | people ${value.subjects?.[0]?.peopleCount ?? 0} | key ${value.keyMomentScore}`
      : `${value.shots?.length ?? 0} shots (${value.shots?.filter((s: any) => s.role === 'A_ROLL').length ?? 0} A-roll), ${value.transcript?.length ?? 0} transcript lines, best ${value.bestMomentSec}s, ends ${Math.max(0, ...(value.shots ?? []).map((s: any) => s.endSec)).toFixed(2)}s of ${videoSeconds.toFixed(2)}s`;
    rows.push({ model, kind, ok: true, note, ...(await usageSince(model, before)) });
  } catch (error: any) {
    rows.push({ model, kind, ok: false, note: String(error.message || error).split('\n')[0].slice(0, 120), ...(await usageSince(model, before)) });
  }
}

async function calls(model: string) {
  try { return (await readFile(path.join(dir, slug(model), 'calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
}
async function callCount(model: string) { return (await calls(model)).length; }
async function usageSince(model: string, from: number) {
  const fresh = (await calls(model)).slice(from);
  return { tokens: fresh.reduce((a, c: any) => a + (c.totalTokens || 0), 0), usd: fresh.reduce((a, c: any) => a + (c.estimatedUsd || 0), 0), ms: fresh.reduce((a, c: any) => a + (c.latencyMs || 0), 0) };
}

try {
  for (const model of list) { await run(model, 'photo'); await run(model, 'video'); }
} finally {
  await cleanupUploads(remoteNames);
}

const table = rows.map(r => `| ${r.model} | ${r.kind} | ${r.ok ? 'ok' : 'FAIL'} | ${r.tokens} | $${r.usd.toFixed(5)} | ${Math.round(r.ms)} | ${r.note.replace(/\|/g, '/')} |`).join('\n');
const md = `# Single-file model probe\n\nPhoto: \`${photo}\`\nVideo: \`${video}\` (${videoSeconds.toFixed(2)}s)\n\n| Model | Input | Result | Tokens | Cost | Latency ms | Summary |\n|---|---|---|---:|---:|---:|---|\n${table}\n\nProbe cost total: **$${rows.reduce((a, r) => a + r.usd, 0).toFixed(5)}**\n`;
await import('node:fs/promises').then(fs => fs.mkdir(dir, { recursive: true }).then(() => fs.writeFile(path.join(dir, 'analyze.md'), md)));
console.log(md);
