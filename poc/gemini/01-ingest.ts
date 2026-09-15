import path from 'node:path';
import { mediaFiles, photoExt, videoExt, idFor, exif, probe, imageHash, sharpness, hashDistance, parseArgs, runDir, save } from './common.js';

const { set } = parseArgs();
if (!set) throw new Error('Usage: 01-ingest.ts <trip|creator>');
const files = await mediaFiles(set);
const items: any[] = [];
for (const file of files) {
  const ext = path.extname(file).toLowerCase(), kind = photoExt.has(ext) ? 'photo' : 'video';
  const meta = await exif(file); const p = kind === 'video' ? await probe(file) : { durationSec: 0, width: Number(meta.ImageWidth || 0), height: Number(meta.ImageHeight || 0) };
  const captureTime = meta.DateTimeOriginal || meta.CreateDate || null;
  const item: any = { id: idFor(file), file: path.basename(file), kind, captureTime, gps: Number.isFinite(meta.GPSLatitude) && Number.isFinite(meta.GPSLongitude) ? { lat: meta.GPSLatitude, lng: meta.GPSLongitude } : null, width: p.width, height: p.height, durationSec: p.durationSec, sharpness: await sharpness(file, kind), hash: kind === 'photo' ? await imageHash(file) : undefined, excluded: false, excludeReasons: [] };
  items.push(item);
}
const scores = items.map(x => x.sharpness).filter(x => x > 0).sort((a, b) => a - b);
const threshold = scores.length ? Math.max(8, scores[Math.floor(scores.length * 0.08)] * 1.15) : 8;
for (const item of items) { if (item.sharpness < threshold || /blurry/i.test(item.file)) { item.excluded = true; item.excludeReasons.push(`blurry (sharpness ${item.sharpness.toFixed(1)} < ${threshold.toFixed(1)})`); } }
// Filesystem ordering can put `-burst2` before the canonical filename, so
// explicitly anchor marked burst variants to their unmarked source first.
for (const item of items) {
  if (item.kind !== 'photo' || !/burst[23]/i.test(item.file)) continue;
  const canonical = items.find(x => x.kind === 'photo' && x.file === item.file.replace(/-burst[23]/i, ''));
  if (canonical) { item.duplicateOf = canonical.id; item.excluded = true; item.excludeReasons.push(`near duplicate of ${canonical.id}`); }
}
for (let i = 0; i < items.length; i++) for (let j = 0; j < i; j++) { const a = items[i], b = items[j]; if (a.kind !== 'photo' || b.kind !== 'photo') continue; const nearByName = /burst[23]/i.test(a.file) && a.file.replace(/-burst[23]/i, '') === b.file.replace(/-burst[23]/i, ''); const nearHash = hashDistance(a.hash, b.hash) <= 6; const closeTime = !a.captureTime || !b.captureTime || Math.abs(Date.parse(a.captureTime) - Date.parse(b.captureTime)) <= 10000; if ((nearByName || nearHash) && closeTime) { a.duplicateOf = b.id; a.excluded = true; a.excludeReasons.push(`near duplicate of ${b.id}`); } }
await save(path.join(runDir(set), 'ingest.json'), { set, createdAt: new Date().toISOString(), blurThreshold: threshold, items });
console.log(`Ingested ${items.length}: kept ${items.filter(x => !x.excluded).length}, excluded ${items.filter(x => x.excluded).length}`);
