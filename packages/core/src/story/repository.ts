import type { AlternativeShot, CreateOption, Direction, DirectionOptions, Film, PlanEdits, StoryPlan } from "./types";
import type { ProjectSummary } from "../chat/types";
import type { EditOp } from "@mosae/contracts";

export type DirectorPerson = { personId: string; name: string | null; role: string | null; momentCount: number; sampleShotIds: string[]; days: number[] };
export type FilmListItem = { projectId: string; filmId: string; title: string; month: string; duration: string; posterUrl: string; justSaved: boolean };
export type ChatInterpretRequest = { step: "occasion" | "people" | "moments" | "direction"; text: string; context: { summary?: ProjectSummary; people?: { personId: string; name: string | null; role: string | null }[] } };
export type ChatInterpretResult = { reply: string; change: { kind: string; [key: string]: unknown } };
export type FilmEdits = { revision: number; ops: EditOp[]; updatedAt: number | null };

export interface StoryRepository {
  listFilms(): Promise<FilmListItem[]>;
  getSummary(projectId: string): Promise<ProjectSummary>;
  interpret(projectId: string, req: ChatInterpretRequest): Promise<ChatInterpretResult>;
  getPeople(projectId: string): Promise<DirectorPerson[]>;
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
  getEdits(projectId: string, generationId: string): Promise<FilmEdits>;
  saveEdits(projectId: string, generationId: string, revision: number, ops: EditOp[]): Promise<FilmEdits>;
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
