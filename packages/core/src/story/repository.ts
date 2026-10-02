import type { AlternativeShot, CreateOption, Direction, DirectionOptions, Film, PlanEdits, StoryPlan } from "./types";
import type { ProjectSummary } from "../chat/types";
import type { EditOp, Timeline } from "@mosae/contracts";
import type { PersonAgeBand } from "../chat/personChips";

export type DirectorPerson = { personId: string; name: string | null; role: string | null; ageBand?: PersonAgeBand; momentCount: number; sampleShotIds: string[]; sampleFaces?: { shotId: string; uri: string; bbox: [number, number, number, number] }[]; days: number[]; similarPersonId?: string; similarity?: number };
export type FilmListStatus = "saved" | "film-ready" | "rendering" | "in-progress";
export type FilmListItem = { projectId: string; filmId: string | null; planId: string | null; title: string; month: string; duration: string; posterUrl: string; justSaved: boolean; status: FilmListStatus; demo?: boolean };
export type ProjectResumeState = { proposalId: string | null; storyText: string | null; generationId: string | null; generationStatus: "composing" | "playable" | "rendering" | "saved" | "failed" | null };
export type ChatInterpretRequest = { step: "occasion" | "people" | "moments" | "direction"; text: string; context: { summary?: ProjectSummary; people?: { personId: string; name: string | null; role: string | null }[] } };
export type ChatInterpretResult = { reply: string; change: { kind: string; [key: string]: unknown } };
export type FilmEdits = { revision: number; ops: EditOp[]; updatedAt: number | null };
export type FilmRender = { revision: number; status: "pending" | "rendering" | "ready" | "failed"; renderProgress?: number; downloadUrl?: string; outputPath?: string };
export type EditorMediaItem = { shotId: string; kind: "photo" | "video"; thumbnailUrl: string; previewUrl: string; date: string; eventLabel: string; sourceInSec?: number; sourceOutSec?: number; sourceDurationSec?: number };
export type FilmTimeline = { timeline: Timeline; sources: Record<string, string>; thumbnails?: Record<string, string>; unusedMedia?: EditorMediaItem[] };
export type EditInterpretation = { reply: string; ops: EditOp[] };

export interface StoryRepository {
  listFilms(): Promise<FilmListItem[]>;
  getProjectResume(projectId: string): Promise<ProjectResumeState>;
  getSummary(projectId: string): Promise<ProjectSummary>;
  interpret(projectId: string, req: ChatInterpretRequest): Promise<ChatInterpretResult>;
  getPeople(projectId: string): Promise<DirectorPerson[] | null>;
  createPlan(storyText: string, mediaRefs: string[]): Promise<{ planId: string }>;
  getPlan(planId: string): Promise<StoryPlan>;
  setMomentSelected(planId: string, momentId: string, selected: boolean): Promise<StoryPlan>;
  setMomentFavorite(planId: string, momentId: string, favorite: boolean): Promise<StoryPlan>;
  reviseMoments(planId: string, request: string): Promise<StoryPlan>;
  /** Replaces the plan's Review edits and returns the new version. No model call. */
  applyEdits(planId: string, edits: PlanEdits): Promise<StoryPlan>;
  /** Other shots of the same moment, for "Swap photo". */
  getAlternatives(planId: string, momentId: string): Promise<AlternativeShot[]>;
  chooseCreateOption(planId: string, option: CreateOption): Promise<{ available: boolean }>;
  getDirectionOptions(planId: string): Promise<DirectionOptions>;
  directFilm(planId: string, direction: Direction): Promise<{ filmId: string }>;
  getFilm(filmId: string): Promise<Film>;
  getFilmTimeline(projectId: string, generationId: string): Promise<FilmTimeline>;
  getEdits(projectId: string, generationId: string): Promise<FilmEdits>;
  interpretEdit(projectId: string, generationId: string, text: string, revision: number): Promise<EditInterpretation>;
  saveEdits(projectId: string, generationId: string, revision: number, ops: EditOp[]): Promise<FilmEdits>;
  renderRevision(projectId: string, generationId: string, revision: number): Promise<{ renderId: string }>;
  getRender(projectId: string, generationId: string, revision: number): Promise<FilmRender>;
  reviseFilm(filmId: string, request: string): Promise<Film>;
  saveFilm(filmId: string): Promise<{ downloadKey: string }>;
}

let current: StoryRepository | null = null;

export function setStoryRepository(repository: StoryRepository) {
  current = repository;
}

export function getStoryRepository(): StoryRepository {
  if (!current) throw new Error("Story repository not configured; call setStoryRepository first.");
  return current;
}
