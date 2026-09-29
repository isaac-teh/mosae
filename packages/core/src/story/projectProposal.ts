import type { PlanEdits, StoryPlan } from "./types";

export type ProposalProjectionSource = {
  id: string;
  title: string;
  moments: Array<{
    id: string;
    shotId: string;
    kind: "photo" | "video";
    title: string;
    description: string;
    rationale: string;
    previewInSec?: number;
    previewOutSec?: number;
  }>;
  chapters: Array<{ id: string; title: string; summary: string; momentIds: string[] }>;
  constraints: {
    deselectedMomentIds: string[];
    mustIncludeMomentIds?: string[];
    hiddenShotIds?: string[];
    excludedShotIds?: string[];
    momentOrder?: string[];
    photoSwaps?: Record<string, string>;
  };
  leftOut?: Array<{ shotId: string; reason: string }>;
};

/** The edits a proposal carries, with every optional list filled in. */
export function editsOf(proposal: ProposalProjectionSource): PlanEdits {
  return {
    deselectedMomentIds: [...proposal.constraints.deselectedMomentIds],
    mustIncludeMomentIds: [...(proposal.constraints.mustIncludeMomentIds ?? [])],
    hiddenShotIds: [...(proposal.constraints.hiddenShotIds ?? [])],
    excludedShotIds: [...(proposal.constraints.excludedShotIds ?? [])],
    momentOrder: [...(proposal.constraints.momentOrder ?? [])],
    photoSwaps: { ...(proposal.constraints.photoSwaps ?? {}) },
  };
}

export type ProjectProjectionSource = {
  id: string;
  title?: string | null;
  place?: string | null;
  dateRange?: string | null;
};

export type ShotProjectionSource = {
  id: string;
  kind: "photo" | "video";
  thumbnailUrl: string;
  eventLabel: string;
};

const CHAPTER_COLORS = ["#a83212", "#855300", "#006579"];

function durationLabel(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (minutes === 0) return `~${remainder} sec film`;
  if (remainder === 0) return `~${minutes} min film`;
  return `~${minutes} min ${remainder} sec film`;
}

function momentSeconds(moment: ProposalProjectionSource["moments"][number]): number {
  if (moment.kind === "video" && moment.previewInSec !== undefined && moment.previewOutSec !== undefined) {
    return Math.max(0, moment.previewOutSec - moment.previewInSec);
  }
  return 3;
}

export type ProposalProjectionOptions = {
  /**
   * Every shot in the project, used for the "add from N other photos" count.
   * Callers that pass only the proposal's own shots leave this out and get 0,
   * which is the truthful answer for the media they supplied.
   */
  totalShotCount?: number;
};

export function projectProposal(
  proposal: ProposalProjectionSource,
  project: ProjectProjectionSource,
  shots: ShotProjectionSource[],
  options: ProposalProjectionOptions = {},
): StoryPlan {
  const shotsById = new Map(shots.map((shot) => [shot.id, shot]));
  const edits = editsOf(proposal);
  const hidden = new Set(edits.hiddenShotIds);
  // A hidden photo takes its moment out of the film until it is un-hidden.
  const deselected = new Set([
    ...edits.deselectedMomentIds,
    ...proposal.moments.filter((moment) => hidden.has(moment.shotId)).map((moment) => moment.id),
  ]);
  const moments = proposal.moments.map((moment) => {
    // A swap to a shot that is hidden or unknown falls back to the original, as compose does.
    const swapped = edits.photoSwaps[moment.id];
    const shownId = swapped && !hidden.has(swapped) && shotsById.has(swapped) ? swapped : moment.shotId;
    const shot = shotsById.get(shownId);
    if (!shot) throw new Error(`Missing shot ${moment.shotId} for moment ${moment.id}`);
    return {
      id: moment.id,
      title: moment.title,
      meta: shot.eventLabel,
      tag: { emoji: "✨", label: "Story moment" },
      imageKey: shot.thumbnailUrl,
      kind: moment.kind,
      durationLabel: moment.kind === "video" ? `${Math.round(momentSeconds(moment))} sec` : undefined,
      ...(moment.kind === "video" && moment.previewInSec !== undefined && moment.previewOutSec !== undefined
        ? { sourceInSec: moment.previewInSec, sourceOutSec: moment.previewOutSec } : {}),
      selected: !deselected.has(moment.id),
      favorite: false,
      shotId: moment.shotId,
      ...(moment.rationale ? { reason: moment.rationale } : {}),
      ...(hidden.has(moment.shotId) ? { hidden: true } : {}),
    };
  });

  const momentsById = new Map(proposal.moments.map((moment) => [moment.id, moment]));
  const chapters = proposal.chapters.map((chapter, index) => {
    const firstMoment = momentsById.get(chapter.momentIds[0]);
    const dayLabel = firstMoment ? shotsById.get(firstMoment.shotId)?.eventLabel ?? "Undated" : "Undated";
    return {
      id: chapter.id,
      dayLabel,
      title: chapter.title,
      subtitle: chapter.summary || `${chapter.momentIds.length} ${chapter.momentIds.length === 1 ? "moment" : "moments"}`,
      badge: { label: `Chapter ${index + 1}`, tone: "neutral" as const },
      dotColor: CHAPTER_COLORS[index % CHAPTER_COLORS.length],
      momentIds: orderWithin(chapter.momentIds, edits.momentOrder),
    };
  });

  const selectedSeconds = proposal.moments
    .filter((moment) => !deselected.has(moment.id))
    .reduce((total, moment) => total + (moment.kind === "video" ? momentSeconds(moment) / 5 : 1) * 3, 0);
  const coverImageKey = moments[0]?.imageKey ?? "";

  return {
    planId: proposal.id,
    title: proposal.title,
    place: project.place ?? "",
    dateRange: project.dateRange ?? "",
    coverImageKey,
    intro: {
      headline: `We found ${moments.length} ${moments.length === 1 ? "moment" : "moments"} that tell your story.`,
      body: "Review the moments selected for your story. Tap any moment to include or leave it out.",
    },
    archivalMatch: [],
    timelineIntro: {
      headline: `We found ${moments.length} ${moments.length === 1 ? "moment" : "moments"} that tell your story.`,
      body: "Organised into a chronological story from your memories.",
      sequence: `${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"}`,
    },
    chapters,
    moments,
    otherPhotoCount: Math.max(0, (options.totalShotCount ?? shots.length) - moments.length),
    albumName: project.title ?? "Memories",
    suggestions: [],
    estimatedFilmLabel: durationLabel(selectedSeconds),
    leftOut: (proposal.leftOut ?? []).map((item) => ({
      shotId: item.shotId, reason: item.reason, thumbnailUrl: shotsById.get(item.shotId)?.thumbnailUrl ?? "",
    })),
    edits,
  };
}

/** A chapter's moments in the user's order; ones the order doesn't mention keep their place after it. */
function orderWithin(momentIds: string[], order: string[]): string[] {
  if (order.length === 0) return [...momentIds];
  const rank = new Map(order.map((id, index) => [id, index]));
  return momentIds.map((id, index) => ({ id, index }))
    .sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.index - b.index)
    .map(({ id }) => id);
}
