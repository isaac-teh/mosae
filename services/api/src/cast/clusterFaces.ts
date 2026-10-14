export type FaceVector = { faceId: string; shotId: string; vector: number[]; modelVersion?: string };
type Cluster = { id: number; faces: FaceVector[]; shots: Set<string>; key: string };
type Candidate = { score: number; leftId: number; rightId: number };

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    if (!Number.isFinite(left) || !Number.isFinite(right)) return -1;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  return normA > 0 && normB > 0 ? dot / Math.sqrt(normA * normB) : -1;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function clusterKey(faces: FaceVector[]): string {
  return faces.map((face) => face.faceId).sort(compareText).join("\u0000");
}

function sharesShot(a: Cluster, b: Cluster): boolean {
  for (const shotId of a.shots) if (b.shots.has(shotId)) return true;
  return false;
}

/** Max-heap with stable id ordering for equal similarities. */
class CandidateHeap {
  private readonly values: Candidate[] = [];

  private before(a: Candidate, b: Candidate): boolean {
    return a.score > b.score || (a.score === b.score && (a.leftId < b.leftId || (a.leftId === b.leftId && a.rightId < b.rightId)));
  }

  push(value: Candidate): void {
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.before(this.values[parent]!, value)) break;
      this.values[index] = this.values[parent]!;
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): Candidate | undefined {
    const top = this.values[0];
    const tail = this.values.pop();
    if (!top || !tail || this.values.length === 0) return top;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.values.length) break;
      const right = left + 1;
      const child = right < this.values.length && this.before(this.values[right]!, this.values[left]!) ? right : left;
      if (this.before(tail, this.values[child]!)) break;
      this.values[index] = this.values[child]!;
      index = child;
    }
    this.values[index] = tail;
    return top;
  }
}

/**
 * Average-linkage clustering uses O(n²) similarity storage and O(n² log n)
 * heap work; it is intended for no more than about 2,000 faces per project.
 */
export function clusterFaces(faces: FaceVector[], opts: { threshold: number; minPhotos: number }): string[][] {
  if (faces.length === 0) return [];
  const maxClusters = faces.length * 2;
  const similarities = Array.from({ length: maxClusters }, () => new Float64Array(maxClusters));
  const heap = new CandidateHeap();
  const clusters = new Map<number, Cluster>();
  const initial = [...faces]
    .sort((a, b) => compareText(a.faceId, b.faceId) || compareText(a.shotId, b.shotId))
    .map((face, id) => ({ id, faces: [face], shots: new Set([face.shotId]), key: face.faceId }));

  for (const cluster of initial) clusters.set(cluster.id, cluster);
  for (let i = 0; i < initial.length; i += 1) for (let j = i + 1; j < initial.length; j += 1) {
    const left = initial[i]!;
    const right = initial[j]!;
    if (sharesShot(left, right)) continue;
    const score = left.faces[0]!.modelVersion !== right.faces[0]!.modelVersion ? -1 : cosine(left.faces[0]!.vector, right.faces[0]!.vector);
    similarities[left.id]![right.id] = score;
    similarities[right.id]![left.id] = score;
    if (score >= opts.threshold) heap.push({ score, leftId: left.id, rightId: right.id });
  }

  let nextId = initial.length;
  while (true) {
    const candidate = heap.pop();
    if (!candidate) break;
    const left = clusters.get(candidate.leftId);
    const right = clusters.get(candidate.rightId);
    if (!left || !right || sharesShot(left, right)) continue;

    const mergedFaces = [...left.faces, ...right.faces]
      .sort((a, b) => compareText(a.faceId, b.faceId) || compareText(a.shotId, b.shotId));
    const merged: Cluster = {
      id: nextId++,
      faces: mergedFaces,
      shots: new Set(mergedFaces.map((face) => face.shotId)),
      key: clusterKey(mergedFaces),
    };

    clusters.delete(left.id);
    clusters.delete(right.id);
    clusters.set(merged.id, merged);
    for (const other of clusters.values()) {
      if (other.id === merged.id || sharesShot(merged, other)) continue;
      // Average linkage updates in O(1) from the previous cluster scores.
      const leftScore = similarities[Math.min(left.id, other.id)]![Math.max(left.id, other.id)]!;
      const rightScore = similarities[Math.min(right.id, other.id)]![Math.max(right.id, other.id)]!;
      const score = (leftScore * left.faces.length + rightScore * right.faces.length) / merged.faces.length;
      similarities[Math.min(merged.id, other.id)]![Math.max(merged.id, other.id)] = score;
      similarities[Math.max(merged.id, other.id)]![Math.min(merged.id, other.id)] = score;
      if (score >= opts.threshold) heap.push({ score, leftId: Math.min(merged.id, other.id), rightId: Math.max(merged.id, other.id) });
    }
  }

  return [...clusters.values()]
    .filter((cluster) => cluster.shots.size >= opts.minPhotos)
    .map((cluster) => cluster.faces.map((face) => face.faceId).sort(compareText))
    .sort((a, b) => b.length - a.length || compareText(a.join("\u0000"), b.join("\u0000")));
}
