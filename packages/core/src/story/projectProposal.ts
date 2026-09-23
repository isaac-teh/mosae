import type { StoryPlan } from "./types";

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
  };
};

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

export function projectProposal(
  proposal: ProposalProjectionSource,
  project: ProjectProjectionSource,
  shots: ShotProjectionSource[],
): StoryPlan {
  const shotsById = new Map(shots.map((shot) => [shot.id, shot]));
  const deselected = new Set(proposal.constraints.deselectedMomentIds);
  const moments = proposal.moments.map((moment) => {
    const shot = shotsById.get(moment.shotId);
    if (!shot) throw new Error(`Missing shot ${moment.shotId} for moment ${moment.id}`);
    return {
      id: moment.id,
      title: moment.title,
      meta: shot.eventLabel,
      tag: { emoji: "✨", label: "Story moment" },
      imageKey: shot.thumbnailUrl,
      kind: moment.kind,
      durationLabel: moment.kind === "video" ? `${Math.round(momentSeconds(moment))} sec` : undefined,
      selected: !deselected.has(moment.id),
      favorite: false,
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
      momentIds: [...chapter.momentIds],
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
    otherPhotoCount: Math.max(0, shots.length - moments.length),
    albumName: project.title ?? "Memories",
    suggestions: [],
    estimatedFilmLabel: durationLabel(selectedSeconds),
  };
}
