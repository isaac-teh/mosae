import type { AlternativeShot, CreateOption, Direction, DirectionOptions, Film, PlanEdits, StoryPlan, EditInterpretContext, EditInterpretation, EditConversationTurn } from "./types";
import type { ProjectSummary } from "../chat/types";
import type { DirectorFlow, FlowAction } from "@mosae/contracts";
import type { EditOp, Timeline } from "@mosae/contracts";
import type { PersonAgeBand } from "../chat/personChips";

export type DirectorPerson = { personId: string; name: string | null; role: string | null; ageBand?: PersonAgeBand; momentCount: number; sampleShotIds: string[]; /** All clustered shot ids, used to remove culled photos from people counts. */ shotIds?: string[]; sampleFaces?: { shotId: string; uri: string; bbox: [number, number, number, number] }[]; days: number[]; similarPersonId?: string; similarity?: number };
export type FilmListStatus = "saved" | "film-ready" | "rendering" | "in-progress";
export type FilmListItem = { projectId: string; filmId: string | null; planId: string | null; title: string; month: string; duration: string; posterUrl: string; justSaved: boolean; status: FilmListStatus; demo?: boolean };
export type ProjectResumeState = { proposalId: string | null; storyText: string | null; generationId: string | null; generationStatus: "composing" | "playable" | "rendering" | "saved" | "failed" | null };
export type ChatInterpretRequest = { step: "occasion" | "people" | "moments" | "direction"; text: string; context: { summary?: ProjectSummary; people?: { personId: string; name: string | null; role: string | null }[]; peopleStage?: "identify" | "tagged" | "missed" | "summary" } };
export type ChatInterpretResult = { reply: string; change: { kind: string; [key: string]: unknown } };
export type FilmEdits = { revision: number; ops: EditOp[]; updatedAt: number | null; sourceDimensions?: Record<string, { width: number; height: number }> };
export type FilmRender = { revision: number; status: "pending" | "rendering" | "ready" | "failed"; renderProgress?: number; downloadUrl?: string; outputPath?: string };
export type EditorMediaItem = { shotId: string; kind: "photo" | "video"; thumbnailUrl: string; previewUrl: string; date: string; eventLabel: string; sourceInSec?: number; sourceOutSec?: number; sourceDurationSec?: number; width?: number; height?: number };
export type FilmTimeline = { timeline: Timeline; sources: Record<string, string>; thumbnails?: Record<string, string>; unusedMedia?: EditorMediaItem[] };
export type { EditInterpretContext, EditInterpretation, EditScope } from "./types";

export interface StoryRepository {
  watchReadiness?(projectId: string, onChange: (snapshot?: { flowRevision?: number }) => void, onError: (error: unknown) => void): () => void;
  listFilms(): Promise<FilmListItem[]>;
  deleteProject(projectId: string): Promise<void>;
  getProjectResume(projectId: string): Promise<ProjectResumeState>;
  getSummary(projectId: string): Promise<ProjectSummary>;
  getFlow?(projectId: string): Promise<DirectorFlow>;
  mutateFlow?(projectId: string, actionId: string, action: FlowAction): Promise<DirectorFlow>;
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
  getEditConversation(projectId: string, generationId: string): Promise<EditConversationTurn[]>;
  acknowledgeEditInterpretation(projectId: string, generationId: string, requestId: string, revision: number): Promise<void>;
  interpretEdit(projectId: string, generationId: string, text: string, revision: number, context?: EditInterpretContext): Promise<EditInterpretation>;
  saveEdits(projectId: string, generationId: string, revision: number, ops: EditOp[]): Promise<FilmEdits>;
  dismissLateVideo(projectId: string, generationId: string, assetId: string): Promise<void>;
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
