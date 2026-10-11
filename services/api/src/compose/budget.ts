import type { Candidate } from "./buildCandidates.js";
import { DIRECTING_RULES } from "./directingRules.js";

export type BudgetAllocation = { selected: Candidate[]; leftOut: Candidate[] };

/** Selects one candidate per video source, then spreads available photo slots across chapters. */
export function allocateBudget(
  candidates: Candidate[],
  scoreByMoment: ReadonlyMap<string, number>,
  lengthSec: number,
  averagePhotoHoldSec: number = DIRECTING_RULES.averagePhotoHoldSec,
  lockedMomentIds: ReadonlySet<string> = new Set(),
): BudgetAllocation {
  const rank = (a: Candidate, b: Candidate) => (scoreByMoment.get(b.itemId) ?? 0) - (scoreByMoment.get(a.itemId) ?? 0) || a.itemId.localeCompare(b.itemId) || a.candidateId.localeCompare(b.candidateId);
  const groupedVideos = new Map<string, Candidate[]>();
  for (const candidate of candidates.filter((entry) => entry.kind === "video")) {
    const group = groupedVideos.get(candidate.itemId) ?? [];
    group.push(candidate);
    groupedVideos.set(candidate.itemId, group);
  }
  const videos = [...groupedVideos.values()].map((group) => [...group].sort((a, b) => (b.windowScore ?? 0) - (a.windowScore ?? 0) || rank(a, b))[0]!).sort((a, b) => a.chapterIndex - b.chapterIndex || rank(a, b));
  const rawVideoSec = videos.reduce((sum, video) => sum + (video.lengthSec ?? 0), 0);
  const selectedVideos = rawVideoSec > lengthSec
    ? videos.map((video) => lockedMomentIds.has(video.itemId) || video.hasSpeech || (video.lengthSec ?? 0) <= DIRECTING_RULES.videoMinClipSec ? video : {
      ...video,
      outSec: Number(((video.inSec ?? 0) + DIRECTING_RULES.videoMinClipSec).toFixed(2)),
      lengthSec: DIRECTING_RULES.videoMinClipSec,
    })
    : videos;

  const photos = candidates.filter((candidate) => candidate.kind === "photo");
  const lockedPhotos = photos.filter((candidate) => lockedMomentIds.has(candidate.itemId));
  const unlocked = photos.filter((candidate) => !lockedMomentIds.has(candidate.itemId));
  const photoSlots = Math.floor(Math.max(0, lengthSec - selectedVideos.reduce((sum, video) => sum + (video.lengthSec ?? 0), 0)) / averagePhotoHoldSec);
  const slotCount = Math.max(0, photoSlots - lockedPhotos.length);
  const chapters = [...new Set(unlocked.map((candidate) => candidate.chapterIndex))].sort((a, b) => a - b);
  const total = unlocked.length;
  const quotas = chapters.map((chapter) => {
    const count = unlocked.filter((candidate) => candidate.chapterIndex === chapter).length;
    const exact = total ? slotCount * count / total : 0;
    return { chapter, count, quota: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let unassigned = Math.max(0, slotCount - quotas.reduce((sum, item) => sum + item.quota, 0));
  for (const item of [...quotas].sort((a, b) => b.remainder - a.remainder || a.chapter - b.chapter)) {
    if (!unassigned) break;
    if (item.quota < item.count) { item.quota++; unassigned--; }
  }
  const selectedPhotos = [...lockedPhotos];
  for (const { chapter, quota } of quotas) {
    selectedPhotos.push(...unlocked.filter((candidate) => candidate.chapterIndex === chapter).sort(rank).slice(0, quota));
  }
  const selectedIds = new Set(selectedPhotos.map((candidate) => candidate.candidateId));
  const selectedItems = new Set(selectedPhotos.map((candidate) => candidate.itemId));
  const leftOut = photos.filter((candidate) => !selectedIds.has(candidate.candidateId) && !selectedItems.has(candidate.itemId));
  return { selected: [...selectedVideos, ...selectedPhotos], leftOut };
}
