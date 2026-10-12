import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { AutoConfig, AutoModel, AutoProcessor, RawImage, env } from '@huggingface/transformers';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '../..');
const data = path.join(here, 'data');
const modelId = 'onnx-community/embeddinggemma-2-ONNX';
const geminiModel = 'gemini-embedding-2';
// Production requests 1536 dimensions because Firestore caps a vector field at 2048.
const geminiDimension = 1536;
const queryPrefix = 'task: search result | query: ';
const documentPrefix = 'title: none | text: ';
const albumIds = ['beach', 'travel', 'speech'];
const albums = albumIds.map((id) => ({ id, data: JSON.parse(fs.readFileSync(path.join(data, `${id}-inputs.json`), 'utf8')) }));
const intents = Object.fromEntries(albums.map(({ id, data }) => [id, data.config.intent]));
const faceFixture = JSON.parse(fs.readFileSync(path.join(repo, 'services/api/fixtures/cast/trip1-v2.json'), 'utf8'));
const imageDir = path.join(repo, 'services/api/fixtures/demo/trip1-v2/photos');
const tempCropDir = path.join(here, '.tmp', 'face-crops');
const outputPath = path.join(here, 'results.json');
const batchMarker = path.join(here, 'gemini-batch-used.txt');
const old = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, 'utf8')) : null;
fs.mkdirSync(tempCropDir, { recursive: true });
const tms = (start) => +(performance.now() - start).toFixed(2);
const cosine = (a, b) => {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return dot / Math.sqrt(aa * bb);
};
function cropRect([ymin, xmin, ymax, xmax], { width, height }) {
  if (!(width > 0 && height > 0) || ![ymin, xmin, ymax, xmax].every(Number.isFinite)) return null;
  if (xmin < 0 || ymin < 0 || xmax > 1 || ymax > 1 || xmax <= xmin || ymax <= ymin) return null;
  const bw = xmax - xmin, bh = ymax - ymin;
  if (bw * width < 48 || bh * height < 48 || bh * height > 1.6 * bw * width || bw * bh > 0.35) return null;
  const left = Math.max(0, Math.floor((xmin - bw * .1) * width + 1e-9));
  const top = Math.max(0, Math.floor((ymin - bh * .1) * height + 1e-9));
  const right = Math.min(width, Math.ceil((xmax + bw * .1) * width - 1e-9));
  const bottom = Math.min(height, Math.ceil((ymax + bh * .1) * height - 1e-9));
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}
async function collectFaceCrops() {
  const files = fs.readdirSync(imageDir).filter((x) => x.toLowerCase().endsWith('.jpg'));
  const imagesByHash = new Map();
  for (const file of files) {
    const jpeg = fs.readFileSync(path.join(imageDir, file));
    imagesByHash.set(crypto.createHash('sha256').update(jpeg).digest('hex'), { file, jpeg });
  }
  const crops = [];
  for (const [hash, rows] of Object.entries(faceFixture.photos)) {
    const image = imagesByHash.get(hash);
    if (!image) continue;
    const meta = await sharp(image.jpeg).metadata();
    for (let i = 0; i < rows.length; i++) {
      const face = rows[i];
      if (!face.personId) continue;
      const rect = cropRect(face.bbox, { width: meta.width ?? 0, height: meta.height ?? 0 });
      if (!rect) continue;
      const jpeg = await sharp(image.jpeg).extract(rect).jpeg({ quality: 90 }).toBuffer();
      const cropPath = path.join(tempCropDir, `${hash.slice(0, 12)}-${i}.jpg`);
      fs.writeFileSync(cropPath, jpeg);
      crops.push({ id: `${hash.slice(0, 12)}-${i}`, identity: face.personId, file: image.file, cropPath, jpeg });
    }
  }
  return crops;
}
function faceMetrics(items, vectors) {
  const pairs = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) pairs.push({ i, j, score: cosine(vectors[i], vectors[j]), same: items[i].identity === items[j].identity });
  const pos = pairs.filter((x) => x.same).map((x) => x.score), neg = pairs.filter((x) => !x.same).map((x) => x.score);
  const sorted = [...pairs].sort((a, b) => a.score - b.score);
  let rankSum = 0;
  for (let i = 0; i < sorted.length;) {
    let end = i + 1;
    while (end < sorted.length && sorted[end].score === sorted[i].score) end++;
    if (sorted[i].same) rankSum += (i + 1 + end) / 2;
    i = end;
  }
  const auc = (rankSum - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
  let best = { threshold: -1, ba: -1, precision: 0, recall: 0 };
  for (const threshold of [...new Set(pairs.map((x) => x.score))]) {
    const tp = pairs.filter((x) => x.same && x.score >= threshold).length;
    const fp = pairs.filter((x) => !x.same && x.score >= threshold).length;
    const recall = tp / pos.length, specificity = (neg.length - fp) / neg.length;
    const ba = (recall + specificity) / 2;
    if (ba > best.ba) best = { threshold, ba, precision: tp / Math.max(1, tp + fp), recall };
  }
  let nn = 0;
  for (let i = 0; i < items.length; i++) {
    const nearest = pairs.filter((x) => x.i === i || x.j === i).sort((a, b) => b.score - a.score)[0];
    const j = nearest.i === i ? nearest.j : nearest.i;
    if (items[i].identity === items[j].identity) nn++;
  }
  const parent = items.map((_, i) => i);
  const find = (x) => parent[x] === x ? x : (parent[x] = find(parent[x]));
  for (const pair of pairs) if (pair.score >= best.threshold) { const a = find(pair.i), b = find(pair.j); if (a !== b) parent[b] = a; }
  const clusters = new Map();
  for (let i = 0; i < items.length; i++) { const root = find(i); if (!clusters.has(root)) clusters.set(root, []); clusters.get(root).push(items[i].identity); }
  const purityNumerator = [...clusters.values()].reduce((sum, labels) => {
    const counts = new Map(); for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
    return sum + Math.max(...counts.values());
  }, 0);
  const avg = (x) => x.reduce((a, b) => a + b, 0) / x.length;
  const med = (x) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)];
  return {
    pairCounts: { sameIdentity: pos.length, differentIdentity: neg.length },
    sameIdentityCosine: { mean: +avg(pos).toFixed(4), median: +med(pos).toFixed(4) },
    differentIdentityCosine: { mean: +avg(neg).toFixed(4), median: +med(neg).toFixed(4) },
    rocAuc: +auc.toFixed(4), nearestNeighborIdentityAccuracy: +(nn / items.length).toFixed(4),
    bestInSampleThreshold: +best.threshold.toFixed(4), bestInSampleBalancedAccuracy: +best.ba.toFixed(4),
    bestInSamplePrecision: +best.precision.toFixed(4), bestInSampleRecall: +best.recall.toFixed(4),
    thresholdClusterCount: clusters.size, thresholdClusterPurity: +(purityNumerator / items.length).toFixed(4),
    thresholdAndPurityAreInSample: true,
  };
}
function ranked(candidates, query, vectors) {
  return candidates.map((candidate, i) => ({ ...candidate, score: +cosine(query, vectors[i]).toFixed(5) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 10);
}
const crops = await collectFaceCrops();
const allFaceFixtureRows = Object.values(faceFixture.photos).flat();
const knownFaceFixtureRows = allFaceFixtureRows.filter((x) => Boolean(x.personId)).length;
const textDocs = albums.flatMap(({ id, data }) => data.candidates.map((c, index) => ({
  album: id, id: c.candidateId, index, description: c.description,
})));
const geminiRequestCount = textDocs.length + albumIds.length + crops.length;
const result = {
  generatedAt: new Date().toISOString(),
  source: {
    albums: albums.map(({ id, data }) => ({ id, intent: data.config.intent, candidateCount: data.candidates.length })),
    faceFixture: 'services/api/fixtures/cast/trip1-v2.json', photoFixture: 'services/api/fixtures/demo/trip1-v2/photos',
    knownFaceCropCount: crops.length,
    identityCounts: Object.fromEntries([...new Set(crops.map((x) => x.identity))].map((label) => [label, crops.filter((x) => x.identity === label).length])),
    excludedUnlabeledOrBackgroundRows: allFaceFixtureRows.length - knownFaceFixtureRows,
    knownIdentityRowsRejectedByCropGeometry: knownFaceFixtureRows - crops.length,
  },
  gemma: { model: modelId, license: 'Apache-2.0', dimensions: 768, quantization: 'q4', runtime: {} },
  gemini: {
    model: geminiModel, nativeDimensions: 3072, productionDimensions: geminiDimension,
    cachedVectorsFound: false, requestedItemsInSingleBatch: geminiRequestCount, callCount: 0,
    liveBatch: { status: 'not attempted' },
  },
  retrieval: {}, faceClustering: { cropCount: crops.length },
};
let peakRss = process.memoryUsage().rss;
const rssSampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 50);
const processor = await AutoProcessor.from_pretrained(modelId);
async function loadModel({ vision }) {
  const config = await AutoConfig.from_pretrained(modelId);
  config.audio_config = null;
  if (!vision) config.vision_config = null;
  const start = performance.now();
  const model = await AutoModel.from_pretrained(modelId, { dtype: 'q4', device: 'cpu', config });
  return { model, loadMs: tms(start), sessions: Object.keys(model.sessions) };
}
function runStats(entries, modelLoadMs, sessions, startRss, endRss, totalMs, perItemMs, extra = {}) {
  return { loadMs: modelLoadMs, sessions, dtype: 'q4', dimension: 768, itemCount: entries, totalEmbeddingMs: +totalMs.toFixed(2), averageMsPerItem: +perItemMs.toFixed(2), rssBeforeModelBytes: startRss, rssAfterInferenceBytes: endRss, peakRssBytes: peakRss, ...extra };
}
// Text-only configuration: use the recommended query/document instruction prefixes.
const rssTextStart = process.memoryUsage().rss;
let { model: textModel, loadMs: textLoadMs, sessions: textSessions } = await loadModel({ vision: false });
const docEmbeddings = new Map(), queryEmbeddings = new Map();
let textMs = 0;
for (let offset = 0; offset < textDocs.length; offset += 8) {
  const batch = textDocs.slice(offset, offset + 8);
  const start = performance.now();
  const encoded = await processor(batch.map((x) => documentPrefix + x.description));
  const vectors = (await textModel(encoded)).sentence_embedding.tolist();
  textMs += tms(start);
  batch.forEach((row, i) => docEmbeddings.set(`${row.album}\0${row.id}`, vectors[i]));
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}
for (const id of albumIds) {
  const start = performance.now();
  const encoded = await processor([queryPrefix + intents[id]]);
  queryEmbeddings.set(id, (await textModel(encoded)).sentence_embedding.tolist()[0]);
  textMs += tms(start);
}
for (const { id, data } of albums) {
  const candidates = data.candidates.map((c, index) => ({ id: c.candidateId, description: c.description, index }));
  result.retrieval.embeddinggemma2 ??= {};
  result.retrieval.embeddinggemma2[id] = ranked(candidates, queryEmbeddings.get(id), candidates.map((x) => docEmbeddings.get(`${id}\0${x.id}`)));
}
result.gemma.runtime.textOnly = runStats(textDocs.length + albumIds.length, textLoadMs, textSessions, rssTextStart, process.memoryUsage().rss, textMs, textMs / (textDocs.length + albumIds.length), { batchSize: 8 });
textModel = null;
if (global.gc) global.gc();
await new Promise((resolve) => setTimeout(resolve, 300));
// Text+vision configuration: matches the face-crop image-embedding job; audio encoder is not loaded.
const rssImageStart = process.memoryUsage().rss;
let { model: imageModel, loadMs: imageLoadMs, sessions: imageSessions } = await loadModel({ vision: true });
const imageVectors = [], imageMs = [];
for (const crop of crops) {
  const start = performance.now();
  const image = await RawImage.read(crop.cropPath);
  const encoded = await processor(null, image);
  imageVectors.push((await imageModel(encoded)).sentence_embedding.tolist()[0]);
  imageMs.push(tms(start));
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}
const imageMsSorted = [...imageMs].sort((a, b) => a - b);
const p95 = imageMsSorted[Math.ceil(imageMsSorted.length * .95) - 1];
result.gemma.runtime.textVision = runStats(crops.length, imageLoadMs, imageSessions, rssImageStart, process.memoryUsage().rss, imageMs.reduce((a, b) => a + b, 0), imageMs.reduce((a, b) => a + b, 0) / imageMs.length, { p95MsPerImage: +p95.toFixed(2) });
result.faceClustering.embeddinggemma2 = faceMetrics(crops, imageVectors);
imageModel = null;
if (global.gc) global.gc();

const onnxDir = path.join(env.cacheDir, 'onnx-community', 'embeddinggemma-2-ONNX', 'onnx');
const size = (name) => { try { return fs.statSync(path.join(onnxDir, name)).size; } catch { return 0; } };
result.gemma.runtime.q4ModelBytes = {
  textEncoder: size('model_q4.onnx') + size('model_q4.onnx_data'),
  visionEncoder: size('vision_encoder_q4.onnx') + size('vision_encoder_q4.onnx_data'),
  audioEncoderNotUsed: size('audio_encoder_q4.onnx') + size('audio_encoder_q4.onnx_data'),
};
result.gemma.runtime.peakRssBytes = peakRss;

// One explicitly authorized Gemini batch for all 62 shot texts, 3 story queries, and 34 face crops.
const priorGemini = old?.gemini?.liveBatch?.status === 'completed' ? old : null;
if (priorGemini) {
  result.gemini = priorGemini.gemini;
  result.retrieval.geminiEmbedding2 = priorGemini.retrieval.geminiEmbedding2;
  result.faceClustering.geminiEmbedding2 = priorGemini.faceClustering.geminiEmbedding2;
} else if (fs.existsSync(batchMarker)) {
  result.gemini.liveBatch = { status: 'not retried: one-batch marker exists', attemptedAt: fs.readFileSync(batchMarker, 'utf8').trim() };
} else if (process.env.GEMINI_BATCH === '1' && process.env.GEMINI_API_KEY) {
  const rows = [];
  for (const x of textDocs) rows.push({ kind: 'document', album: x.album, id: x.id, content: { parts: [{ text: documentPrefix + x.description }] }, taskType: 'RETRIEVAL_DOCUMENT' });
  for (const id of albumIds) rows.push({ kind: 'query', album: id, id, content: { parts: [{ text: queryPrefix + intents[id] }] }, taskType: 'RETRIEVAL_QUERY' });
  for (const x of crops) rows.push({ kind: 'face', id: x.id, content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: x.jpeg.toString('base64') } }] } });
  if (rows.length > 100) throw new Error(`Refusing Gemini batch >100 requests (${rows.length})`);
  fs.writeFileSync(batchMarker, new Date().toISOString());
  const body = { requests: rows.map((x) => ({ model: `models/${geminiModel}`, content: x.content, ...(x.taskType ? { taskType: x.taskType } : {}), outputDimensionality: geminiDimension })) };
  const requestBytes = Buffer.byteLength(JSON.stringify(body));
  result.gemini.callCount = 1;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:batchEmbedContents?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(`Gemini batch HTTP ${response.status}`);
    const payload = await response.json();
    const vectors = payload.embeddings?.map((x) => x.values);
    if (!vectors || vectors.length !== rows.length) throw new Error(`Gemini returned ${vectors?.length ?? 0}/${rows.length} vectors`);
    const docs = Object.fromEntries(albumIds.map((id) => [id, []]));
    const query = {};
    const faces = [];
    rows.forEach((row, i) => {
      if (row.kind === 'document') docs[row.album].push(vectors[i]);
      else if (row.kind === 'query') query[row.album] = vectors[i];
      else faces.push(vectors[i]);
    });
    result.retrieval.geminiEmbedding2 = {};
    for (const { id, data } of albums) {
      const candidates = data.candidates.map((c, index) => ({ id: c.candidateId, description: c.description, index }));
      result.retrieval.geminiEmbedding2[id] = ranked(candidates, query[id], docs[id]);
    }
    result.faceClustering.geminiEmbedding2 = faceMetrics(crops, faces);
    const textTokensApprox = textDocs.reduce((n, x) => n + Math.ceil(x.description.length / 4), 0) + albumIds.reduce((n, id) => n + Math.ceil(intents[id].length / 4), 0);
    const estimatedTokens = textTokensApprox + crops.length * 280;
    result.gemini.liveBatch = {
      status: 'completed', attemptedAt: fs.readFileSync(batchMarker, 'utf8').trim(), itemCount: rows.length, requestBytes,
      estimatedInputTokens: estimatedTokens, usdPerMillionInputTokens: 0.2,
      estimatedCostUsd: +(estimatedTokens * .2 / 1_000_000).toFixed(6),
      estimateBasis: 'text characters/4 plus 280 image tokens per crop; one request batch, API returned no usage metadata',
      returnedDimension: vectors[0]?.length ?? null,
    };
  } catch (error) {
    result.gemini.liveBatch = { status: 'failed, not retried', attemptedAt: fs.readFileSync(batchMarker, 'utf8').trim(), detail: error instanceof Error ? error.message : 'unknown error', itemCount: rows.length, requestBytes };
  }
} else {
  result.gemini.liveBatch = { status: 'not called: GEMINI_BATCH=1 or GEMINI_API_KEY missing' };
}
result.gemini.cachedVectorsFound = false;
result.gemini.callCount = result.gemini.liveBatch?.status === 'completed' ? 1 : (priorGemini?.gemini?.callCount ?? 0);
clearInterval(rssSampler);
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  candidates: result.source.albums.map((x) => [x.id, x.candidateCount]), faceCrops: result.source.knownFaceCropCount,
  gemini: result.gemini.liveBatch, textOnly: result.gemma.runtime.textOnly, textVision: result.gemma.runtime.textVision,
  faceMetricsGemma: result.faceClustering.embeddinggemma2,
}, null, 2));
