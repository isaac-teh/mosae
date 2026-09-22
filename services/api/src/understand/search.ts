export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length); let dot = 0; let magA = 0; let magB = 0;
  for (let i = 0; i < len; i += 1) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  return magA === 0 || magB === 0 ? 0 : dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
export type SearchableShot = { id: string; assetId: string; embedding: number[] };
export type RankedShot = { id: string; assetId: string; score: number };
export function rankShots(queryEmbedding: number[], shots: SearchableShot[], limit: number): RankedShot[] {
  return shots.map((shot) => ({ id: shot.id, assetId: shot.assetId, score: cosineSimilarity(queryEmbedding, shot.embedding) })).sort((a, b) => b.score - a.score).slice(0, limit);
}
