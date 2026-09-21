import type { MediaKind } from "../domain/media.js";

export type DupCandidate = { id: string; kind: MediaKind; dHash: string | null; sharpness: number; localTime: string | null };
/** `memberIds` are the duplicates; the primary is not repeated in it. */
export type DupGroup = { primaryId: string; memberIds: string[] };

export const DUP_MAX_BITS = 6;
export const DUP_WINDOW_MS = 10_000;

/**
 * Only dated photos are compared, and only within a ten second window, using a
 * cheap distance. This is worst case quadratic within one ten second window. Videos are never merged and
 * undated photos are left alone, because without a time the hash alone would
 * merge unrelated look-alikes.
 */
export function groupNearDuplicates(items: DupCandidate[]): DupGroup[] {
  const photos = items
    .filter((item) => item.kind === "photo" && item.dHash && item.localTime)
    .map((item) => {
      const dHash = item.dHash as string;
      return { ...item, ms: Date.parse(`${item.localTime}Z`), dHash, hi: Number.parseInt(dHash.slice(0, 8), 16) >>> 0, lo: Number.parseInt(dHash.slice(8), 16) >>> 0 };
    })
    .filter((item) => !Number.isNaN(item.ms))
    .sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id));

  const parent = new Map(photos.map((photo) => [photo.id, photo.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    return root;
  };

  for (let i = 0; i < photos.length; i += 1) {
    for (let j = i + 1; j < photos.length && photos[j].ms - photos[i].ms <= DUP_WINDOW_MS; j += 1) {
      if (hamming64(photos[i].hi, photos[i].lo, photos[j].hi, photos[j].lo) <= DUP_MAX_BITS) {
        parent.set(find(photos[j].id), find(photos[i].id));
      }
    }
  }

  const byRoot = new Map<string, typeof photos>();
  for (const photo of photos) {
    const root = find(photo.id);
    byRoot.set(root, [...(byRoot.get(root) ?? []), photo]);
  }

  const groups: DupGroup[] = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    const ranked = [...members].sort((a, b) => b.sharpness - a.sharpness || a.id.localeCompare(b.id));
    const [primary, ...rest] = ranked;
    groups.push({ primaryId: primary.id, memberIds: rest.map((member) => member.id).sort() });
  }
  return groups.sort((a, b) => a.primaryId.localeCompare(b.primaryId));
}

function popcount(value: number): number {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Hamming distance for two pre-parsed unsigned 64-bit hashes. */
export function hamming64(hiA: number, loA: number, hiB: number, loB: number): number {
  return popcount((hiA ^ hiB) >>> 0) + popcount((loA ^ loB) >>> 0);
}
