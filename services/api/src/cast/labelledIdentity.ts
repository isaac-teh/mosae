import type { FaceRef, IdentityResolver } from "./types.js";

export type LabelFile = {
  people: Record<string, object>;
  photos: Record<string, { bbox: [number, number, number, number]; personId: string }[]>;
};

export function iou(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const [yminA, xminA, ymaxA, xmaxA] = a;
  const [yminB, xminB, ymaxB, xmaxB] = b;

  const interYmin = Math.max(yminA, yminB);
  const interXmin = Math.max(xminA, xminB);
  const interYmax = Math.min(ymaxA, ymaxB);
  const interXmax = Math.min(xmaxA, xmaxB);

  const interH = Math.max(0, interYmax - interYmin);
  const interW = Math.max(0, interXmax - interXmin);
  const interArea = interH * interW;

  const areaA = Math.max(0, ymaxA - yminA) * Math.max(0, xmaxA - xminA);
  const areaB = Math.max(0, ymaxB - yminB) * Math.max(0, xmaxB - xminB);
  const unionArea = areaA + areaB - interArea;

  if (unionArea <= 0) return 0;
  return interArea / unionArea;
}

export function labelledIdentity(labels: LabelFile): IdentityResolver {
  return {
    source: "labelled",
    resolve(faces: FaceRef[]): Map<string, string> {
      const result = new Map<string, string>();

      const facesByPhoto = new Map<string, FaceRef[]>();
      for (const face of faces) {
        let list = facesByPhoto.get(face.photoHash);
        if (!list) {
          list = [];
          facesByPhoto.set(face.photoHash, list);
        }
        list.push(face);
      }

      for (const [photoHash, photoFaces] of facesByPhoto.entries()) {
        const photoLabels = labels.photos[photoHash];
        if (!photoLabels || photoLabels.length === 0) continue;

        const pairs: {
          faceId: string;
          labelIdx: number;
          personId: string;
          score: number;
        }[] = [];

        for (const f of photoFaces) {
          for (let lIdx = 0; lIdx < photoLabels.length; lIdx++) {
            const label = photoLabels[lIdx];
            const score = iou(f.bbox, label.bbox);
            if (score > 0.5) {
              pairs.push({
                faceId: f.faceId,
                labelIdx: lIdx,
                personId: label.personId,
                score,
              });
            }
          }
        }

        pairs.sort((p1, p2) => p2.score - p1.score);

        const usedFaces = new Set<string>();
        const usedLabels = new Set<number>();

        for (const pair of pairs) {
          if (usedFaces.has(pair.faceId) || usedLabels.has(pair.labelIdx)) {
            continue;
          }
          usedFaces.add(pair.faceId);
          usedLabels.add(pair.labelIdx);
          result.set(pair.faceId, pair.personId);
        }
      }

      return result;
    },
  };
}

export function labelsCover(labels: LabelFile, photoHashes: string[]): boolean {
  if (photoHashes.length === 0) return false;
  const covered = photoHashes.filter((hash) => Object.prototype.hasOwnProperty.call(labels.photos, hash)).length;
  return covered / photoHashes.length >= 0.5;
}
