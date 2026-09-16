import type { CreateOption, Direction, DirectionOptions, Film, StoryPlan } from "./types";

export interface StoryRepository {
  createPlan(storyText: string, mediaRefs: string[]): Promise<{ planId: string }>;
  getPlan(planId: string): Promise<StoryPlan>;
  setMomentSelected(planId: string, momentId: string, selected: boolean): Promise<StoryPlan>;
  setMomentFavorite(planId: string, momentId: string, favorite: boolean): Promise<StoryPlan>;
  reviseMoments(planId: string, request: string): Promise<StoryPlan>;
  chooseCreateOption(planId: string, option: CreateOption): Promise<{ available: boolean }>;
  getDirectionOptions(planId: string): Promise<DirectionOptions>;
  directFilm(planId: string, direction: Direction): Promise<{ filmId: string }>;
  getFilm(filmId: string): Promise<Film>;
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
