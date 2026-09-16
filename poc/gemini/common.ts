import { GoogleGenAI } from '@google/genai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, appendFile, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { models, prices, ROOT, thinkingLevelFor } from './config.js';

const exec = promisify(execFile);
export const photoExt = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);
export const videoExt = new Set(['.mp4', '.mov', '.m4v', '.webm']);
export const slug = (model: string) => model.replace(/^models\//, '').replace(/[^a-z0-9]+/gi, '-');
export const runDir = (set: string, model: string = models.analyze) => path.join(ROOT, 'out', set, slug(model));
export const sampleDir = (set: string) => path.join(ROOT, 'samples', set);
export const idFor = (file: string) => path.basename(file, path.extname(file));
export const mimeFor = (file: string) => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm' }[path.extname(file).toLowerCase()] || 'application/octet-stream');
export async function json<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }
export async function save(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2) + '\n'); }
export async function mediaFiles(set: string) { const dir = sampleDir(set); return (await readdir(dir)).map(x => path.join(dir, x)).filter(async () => true).filter(x => photoExt.has(path.extname(x).toLowerCase()) || videoExt.has(path.extname(x).toLowerCase())).sort(); }
export async function shell(file: string, args: string[]) { return exec(file, args, { maxBuffer: 20 * 1024 * 1024 }); }
export async function probe(file: string) { const { stdout } = await shell('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', file]); const x = JSON.parse(stdout); const s = x.streams?.find((v: any) => v.width) || {}; return { durationSec: Number(x.format?.duration || 0), width: Number(s.width || 0), height: Number(s.height || 0) }; }
export async function exif(file: string) { try { const { stdout } = await shell('exiftool', ['-j', '-n', '-DateTimeOriginal', '-CreateDate', '-GPSLatitude', '-GPSLongitude', '-ImageWidth', '-ImageHeight', file]); return JSON.parse(stdout)[0] || {}; } catch { return {}; } }
export async function imageHash(file: string) { const pixels = await sharp(file, { failOn: 'none' }).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer(); let hash = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash += pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? '1' : '0'; return hash; }
export function hashDistance(a?: string, b?: string) { if (!a || !b) return 99; return [...a].filter((x, i) => x !== b[i]).length; }
// Return the 75th-percentile tile score rather than a whole-frame score. This
// preserves intentionally shallow-focus food and portrait shots when another
// part of the frame is crisp, while still rejecting a uniformly defocused frame.
export async function sharpness(file: string, kind: string) {
  try {
    let input: Buffer, width: number, height: number;
    if (kind === 'photo') {
      const image = sharp(file, { failOn: 'none' }).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).grayscale();
      const result = await image.raw().toBuffer({ resolveWithObject: true }); input = result.data; width = result.info.width; height = result.info.height;
    } else {
      const result = await shell('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', file, '-frames:v', '1', '-vf', 'scale=512:-2:force_original_aspect_ratio=decrease,format=gray', '-f', 'rawvideo', 'pipe:1']);
      input = result.stdout as unknown as Buffer;
      const p = await probe(file); width = 512; height = Math.max(1, Math.floor(p.height * 512 / Math.max(p.width, 1) / 2) * 2);
    }
    const tiles: number[] = [];
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      const x0 = Math.floor(tx * width / 4), x1 = Math.floor((tx + 1) * width / 4);
      const y0 = Math.floor(ty * height / 4), y1 = Math.floor((ty + 1) * height / 4);
      let n = 0, sum = 0, sum2 = 0;
      for (let y = Math.max(1, y0); y < Math.min(height - 1, y1); y++) for (let x = Math.max(1, x0); x < Math.min(width - 1, x1); x++) {
        const i = y * width + x; const lap = 4 * input[i] - input[i - 1] - input[i + 1] - input[i - width] - input[i + width]; n++; sum += lap; sum2 += lap * lap;
      }
      if (n) tiles.push(sum2 / n - (sum / n) ** 2);
    }
    tiles.sort((a, b) => a - b); return tiles[Math.floor(tiles.length * .75)] || 0;
  } catch { return 0; }
}
export function parseArgs(args = process.argv.slice(2)) { const set = args.find(x => !x.startsWith('--')); const at = args.indexOf('--model'); return { set, model: at >= 0 ? args[at + 1] : undefined }; }
export const ai = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
export async function recordCall(dir: string, call: Record<string, unknown>) { await mkdir(dir, { recursive: true }); await appendFile(path.join(dir, 'calls.jsonl'), JSON.stringify(call) + '\n'); }
const nextRequestAt = new Map<string, number>();
function rawApiError(error: any) {
  // The SDK puts the server's JSON body in different properties across releases.
  // Preserve every available representation so a quota or availability blocker
  // can be independently verified from calls.jsonl and the generated report.
  const message = String(error?.message || error);
  let body: any = error?.response?.data ?? error?.error ?? error?.body;
  if (body == null) {
    const start = message.indexOf('{');
    if (start >= 0) try { body = JSON.parse(message.slice(start)); } catch { /* retain message below */ }
  }
  const api = body?.error ?? body;
  return {
    status: error?.status ?? error?.response?.status ?? api?.code,
    code: api?.status ?? api?.code ?? error?.code,
    message: api?.message ?? message,
    retryInfo: api?.details?.find?.((detail: any) => detail?.['@type']?.includes('RetryInfo')) ?? api?.retryInfo,
    body: body ?? message,
  };
}
async function rateLimit(model: string) {
  if (model !== models.analyzeCompare) return;
  const waitMs = Math.max(0, (nextRequestAt.get(model) || 0) - Date.now());
  if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
  // A serial 12 RPM limiter provides headroom while preserving the requested
  // comparison cadence independently of the account's service tier.
  nextRequestAt.set(model, Date.now() + 5000);
}
export async function generate<T>(opts: { dir: string; stage: string; model: string; file?: string; contents: any; schema: any; validate: (value: unknown) => T; thinking?: boolean }) {
  const client = ai(); let last: Error | undefined;
  // 503 retries use 10, 20, 40, 80, and 120 seconds, totaling five minutes
  // per file. Other retryable errors retain the short bounded retry policy.
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const started = Date.now();
    try {
      await rateLimit(opts.model);
      const response: any = await client.models.generateContent({ model: opts.model, contents: opts.contents, config: { responseMimeType: 'application/json', responseJsonSchema: opts.schema, mediaResolution: 'MEDIA_RESOLUTION_LOW', ...(opts.thinking ? { thinkingConfig: { thinkingLevel: thinkingLevelFor(opts.model) } } : {}) } } as any);
      const usage = response.usageMetadata || {}; const promptTokens = usage.promptTokenCount || 0; const candidatesTokens = usage.candidatesTokenCount || 0; const thoughtsTokens = usage.thoughtsTokenCount || 0; const p = prices[opts.model] || { input: 0, output: 0 }; const estimatedUsd = (promptTokens * p.input + (candidatesTokens + thoughtsTokens) * p.output) / 1_000_000;
      await recordCall(opts.dir, { stage: opts.stage, model: opts.model, file: opts.file, promptTokens, candidatesTokens, thoughtsTokens, totalTokens: usage.totalTokenCount || promptTokens + candidatesTokens + thoughtsTokens, latencyMs: Date.now() - started, estimatedUsd, attempt: attempt + 1 });
      return opts.validate(JSON.parse(response.text));
    } catch (e: any) {
      last = e;
      const rawError = rawApiError(e);
      await recordCall(opts.dir, { stage: opts.stage, model: opts.model, file: opts.file, promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 0, totalTokens: 0, latencyMs: Date.now() - started, estimatedUsd: 0, attempt: attempt + 1, error: String(e.message || e), rawError });
      const retryable = /(?:429|5\d\d|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL)/i.test(String(e.message || e));
      if (!retryable || attempt === maxAttempts - 1) break;
      const baseMs = /5\d\d|UNAVAILABLE|INTERNAL/i.test(String(e.message || e)) ? 10_000 : 1_000;
      const delayMs = Math.min(120_000, baseMs * 2 ** attempt);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw last;
}
export async function uploadVideo(file: string) { const client: any = ai(); const uploaded = await client.files.upload({ file, config: { mimeType: mimeFor(file) } }); let remote = uploaded; while (remote.state === 'PROCESSING') { await new Promise(r => setTimeout(r, 2000)); remote = await client.files.get({ name: remote.name }); } if (remote.state !== 'ACTIVE') throw new Error(`Upload ${file} did not become ACTIVE: ${remote.state}`); return { client, remote }; }
export async function cleanupUploads(names: string[]) { const client: any = ai(); await Promise.all(names.map(name => client.files.delete({ name }).catch(() => undefined))); }
export const AnalysisSchema = z.object({ kind: z.enum(['photo', 'video']), caption: z.string().optional(), subjects: z.array(z.object({ peopleCount: z.number().int().min(0), roles: z.array(z.string()), attributes: z.array(z.string()) })).optional(), setting: z.string().optional(), activities: z.array(z.string()).optional(), mood: z.string().optional(), shotType: z.string().optional(), aesthetics: z.number().min(1).max(5).optional(), keyMomentScore: z.number().min(1).max(5).optional(), tags: z.array(z.string()).optional(), shots: z.array(z.object({ startSec: z.number().min(0), endSec: z.number().min(0), shotType: z.string(), camera: z.string(), role: z.enum(['A_ROLL', 'B_ROLL']), description: z.string(), subjects: z.array(z.string()), emotion: z.string(), quality: z.number().min(1).max(5), usable: z.boolean(), reason: z.string() })).optional(), transcript: z.array(z.object({ startSec: z.number().min(0), endSec: z.number().min(0), text: z.string() })).optional(), bestMomentSec: z.number().min(0).optional() });
export type Analysis = z.infer<typeof AnalysisSchema>;
export async function exists(file: string) { try { await stat(file); return true; } catch { return false; } }
export async function cleanRun(set: string, model: string) { await rm(runDir(set, model), { recursive: true, force: true }); }
