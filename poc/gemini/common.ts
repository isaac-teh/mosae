import { GoogleGenAI } from '@google/genai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, appendFile, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { models, prices, ROOT } from './config.js';

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
export async function sharpness(file: string, kind: string) { try { let input: Buffer; if (kind === 'photo') input = await sharp(file, { failOn: 'none' }).resize(320, 320, { fit: 'inside' }).grayscale().raw().toBuffer(); else input = (await shell('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2,format=gray', '-f', 'rawvideo', 'pipe:1'])).stdout as unknown as Buffer; const width = 320; let n = 0, sum = 0, sum2 = 0; for (let i = width + 1; i < input.length - width - 1; i++) { const lap = 4 * input[i] - input[i - 1] - input[i + 1] - input[i - width] - input[i + width]; n++; sum += lap; sum2 += lap * lap; } return n ? sum2 / n - (sum / n) ** 2 : 0; } catch { return 0; } }
export function parseArgs(args = process.argv.slice(2)) { const set = args.find(x => !x.startsWith('--')); const at = args.indexOf('--model'); return { set, model: at >= 0 ? args[at + 1] : undefined }; }
export const ai = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
export async function recordCall(dir: string, call: Record<string, unknown>) { await mkdir(dir, { recursive: true }); await appendFile(path.join(dir, 'calls.jsonl'), JSON.stringify(call) + '\n'); }
export async function generate<T>(opts: { dir: string; stage: string; model: string; file?: string; contents: any; schema: any; validate: (value: unknown) => T; thinking?: boolean }) {
  const client = ai(); let last: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const response: any = await client.models.generateContent({ model: opts.model, contents: opts.contents, config: { responseMimeType: 'application/json', responseJsonSchema: opts.schema, mediaResolution: 'MEDIA_RESOLUTION_LOW', ...(opts.thinking ? { thinkingConfig: { thinkingLevel: 'MINIMAL' } } : {}) } } as any);
      const usage = response.usageMetadata || {}; const promptTokens = usage.promptTokenCount || 0; const candidatesTokens = usage.candidatesTokenCount || 0; const thoughtsTokens = usage.thoughtsTokenCount || 0; const p = prices[opts.model] || { input: 0, output: 0 }; const estimatedUsd = (promptTokens * p.input + (candidatesTokens + thoughtsTokens) * p.output) / 1_000_000;
      await recordCall(opts.dir, { stage: opts.stage, model: opts.model, file: opts.file, promptTokens, candidatesTokens, thoughtsTokens, totalTokens: usage.totalTokenCount || promptTokens + candidatesTokens + thoughtsTokens, latencyMs: Date.now() - started, estimatedUsd, attempt: attempt + 1 });
      return opts.validate(JSON.parse(response.text));
    } catch (e: any) { last = e; if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  throw last;
}
export async function uploadVideo(file: string) { const client: any = ai(); const uploaded = await client.files.upload({ file, config: { mimeType: mimeFor(file) } }); let remote = uploaded; while (remote.state === 'PROCESSING') { await new Promise(r => setTimeout(r, 2000)); remote = await client.files.get({ name: remote.name }); } if (remote.state !== 'ACTIVE') throw new Error(`Upload ${file} did not become ACTIVE: ${remote.state}`); return { client, remote }; }
export async function cleanupUploads(names: string[]) { const client: any = ai(); await Promise.all(names.map(name => client.files.delete({ name }).catch(() => undefined))); }
export const AnalysisSchema = z.object({ kind: z.enum(['photo', 'video']), caption: z.string().optional(), subjects: z.array(z.object({ peopleCount: z.number().int().min(0), roles: z.array(z.string()), attributes: z.array(z.string()) })).optional(), setting: z.string().optional(), activities: z.array(z.string()).optional(), mood: z.string().optional(), shotType: z.string().optional(), aesthetics: z.number().min(1).max(5).optional(), keyMomentScore: z.number().min(1).max(5).optional(), tags: z.array(z.string()).optional(), shots: z.array(z.object({ startSec: z.number().min(0), endSec: z.number().min(0), shotType: z.string(), camera: z.string(), role: z.enum(['A_ROLL', 'B_ROLL']), description: z.string(), subjects: z.array(z.string()), emotion: z.string(), quality: z.number().min(1).max(5), usable: z.boolean(), reason: z.string() })).optional(), transcript: z.array(z.object({ startSec: z.number().min(0), endSec: z.number().min(0), text: z.string() })).optional(), bestMomentSec: z.number().min(0).optional() });
export type Analysis = z.infer<typeof AnalysisSchema>;
export async function exists(file: string) { try { await stat(file); return true; } catch { return false; } }
export async function cleanRun(set: string, model: string) { await rm(runDir(set, model), { recursive: true, force: true }); }
