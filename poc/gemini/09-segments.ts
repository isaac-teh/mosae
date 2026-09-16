import path from 'node:path';
import { ai, json, parseArgs, recordCall, runDir, save } from './common.js';
import { models, prices } from './config.js';

type Entry = { id: string; itemId: string; file: string; kind: 'photo' | 'item' | 'shot' | 'transcript'; startSec?: number; endSec?: number; text: string; embedding: number[] };
const { set } = parseArgs();
if (!set) throw new Error('Usage: 09-segments.ts <set>');
const dir = runDir(set);
const catalog: any = await json(path.join(dir, 'catalog.json'));
const itemVectors: any = await json(path.join(dir, 'embeddings.json'));
const old = await json<{ entries: Entry[] }>(path.join(dir, 'segments.json')).catch(() => ({ entries: [] }));
const cached = new Map(old.entries.map(x => [`${x.itemId}|${x.kind}|${x.startSec ?? ''}|${x.endSec ?? ''}|${x.text}`, x.embedding]));
const byItem = new Map(itemVectors.itemIds.map((id: string, i: number) => [id, itemVectors.embeddings[i] as number[]]));
const pending: Omit<Entry, 'embedding'>[] = [];
const entries: Entry[] = [];
function add(entry: Omit<Entry, 'embedding'>, existing?: number[]) {
  const key = `${entry.itemId}|${entry.kind}|${entry.startSec ?? ''}|${entry.endSec ?? ''}|${entry.text}`;
  if (existing) entries.push({ ...entry, embedding: existing });
  else if (cached.get(key)) entries.push({ ...entry, embedding: cached.get(key)! });
  else pending.push(entry);
}
for (const item of catalog.items) {
  add({ id: `${item.id}:${item.kind === 'photo' ? 'photo' : 'item'}`, itemId: item.id, file: item.file, kind: item.kind === 'photo' ? 'photo' : 'item', text: item.text }, byItem.get(item.id) as number[] | undefined);
  if (item.kind !== 'video') continue;
  const transcript = item.analysis?.transcript || [];
  for (let i = 0; i < (item.analysis?.shots || []).length; i++) {
    const shot = item.analysis.shots[i];
    const spoken = transcript.filter((t: any) => t.startSec < shot.endSec && t.endSec > shot.startSec).map((t: any) => t.text).join(' ');
    const text = `${shot.role} ${shot.shotType}: ${shot.description}; subjects: ${(shot.subjects || []).join(', ')}${spoken ? `; transcript: ${spoken}` : ''}`;
    add({ id: `${item.id}:shot:${i}`, itemId: item.id, file: item.file, kind: 'shot', startSec: shot.startSec, endSec: shot.endSec, text });
  }
  for (let i = 0; i < transcript.length; i++) {
    const part = transcript[i];
    add({ id: `${item.id}:transcript:${i}`, itemId: item.id, file: item.file, kind: 'transcript', startSec: part.startSec, endSec: part.endSec, text: part.text });
  }
}
let spent = 0;
const client: any = ai();
for (let at = 0; at < pending.length; at += 50) {
  const batch = pending.slice(at, at + 50); const started = Date.now();
  const response: any = await client.models.embedContent({ model: models.embed, contents: batch.map(x => ({ parts: [{ text: x.text }] })), config: { outputDimensionality: 768 } });
  const vectors = response.embeddings?.map((x: any) => x.values);
  if (!vectors || vectors.length !== batch.length || vectors.some((x: any) => !x)) throw new Error('Segment embedding response was incomplete');
  const counted: any = response.usageMetadata?.promptTokenCount == null ? await client.models.countTokens({ model: models.embed, contents: batch.map(x => ({ parts: [{ text: x.text }] })) }) : undefined;
  const tokens = response.usageMetadata?.promptTokenCount ?? counted?.totalTokens ?? 0;
  const estimatedUsd = tokens * prices[models.embed].input / 1_000_000; spent += estimatedUsd;
  await recordCall(dir, { stage: 'embed-segment', model: models.embed, file: batch.map(x => x.file).join(','), promptTokens: tokens, candidatesTokens: 0, thoughtsTokens: 0, totalTokens: tokens, latencyMs: Date.now() - started, estimatedUsd });
  batch.forEach((entry, i) => entries.push({ ...entry, embedding: vectors[i] }));
}
entries.sort((a, b) => a.id.localeCompare(b.id));
await save(path.join(dir, 'segments.json'), { model: models.embed, entries });
console.log(`${set}: ${entries.length} entries (${pending.length} newly embedded), estimated embedding cost $${spent.toFixed(6)}`);
