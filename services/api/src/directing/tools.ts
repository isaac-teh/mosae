import type { AssetStatus } from "../domain/assetStatus.js";
import type { MediaKind } from "../domain/media.js";
import type { TranscriptLine } from "../domain/understanding.js";
import { MODELS } from "../gemini/pricing.js";
import type { EmbedContent } from "../understand/embed.js";
import { rankShots } from "../understand/search.js";
import { compactShotLine, type WorkingShot } from "./workingSet.js";

export type PlanningShot = WorkingShot & {
  projectId: string;
  assetId: string;
  embedding: number[] | null;
  sourceStartSec: number | null;
  sourceEndSec: number | null;
};

export type PlanningAsset = {
  id: string;
  projectId: string;
  kind: MediaKind;
  transcript: TranscriptLine[] | null;
};

export type ShotFilters = {
  day?: string;
  place?: string;
  eventId?: string;
  kind?: MediaKind;
};

export type PlanningToolsDeps = {
  projectId: string;
  excludedShotIds: string[];
  embedContent: EmbedContent;
  /** The implementation must use the supplied project id in its datastore path. */
  loadShots(projectId: string): Promise<PlanningShot[]>;
  /** The implementation must use the supplied project id in its datastore path. */
  loadAsset(projectId: string, assetId: string): Promise<PlanningAsset | null>;
};

export type ShotDetails = Omit<PlanningShot, "embedding">;

const SEARCH_DEFAULT = 12;
const SEARCH_MAX = 30;
const DETAIL_MAX = 10;
const TRANSCRIPT_MAX = 120;

function clampLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(0, Math.trunc(value)));
}

function matchesFilters(shot: PlanningShot, filters: ShotFilters | undefined): boolean {
  if (!filters) return true;
  if (filters.day !== undefined && shot.day !== filters.day) return false;
  if (filters.place !== undefined && shot.place !== filters.place) return false;
  if (filters.eventId !== undefined && shot.eventId !== filters.eventId) return false;
  if (filters.kind !== undefined && shot.analysis?.kind !== filters.kind) return false;
  return true;
}

function isEligible(shot: PlanningShot, projectId: string, excluded: Set<string>): boolean {
  const status: AssetStatus | undefined = shot.assetStatus ?? shot.status ?? shot.asset?.status;
  return shot.projectId === projectId
    && !excluded.has(shot.id)
    && status === "understood"
    && shot.analysis !== null
    && !(shot.analysis.kind === "video" && !shot.analysis.usable)
    && !shot.dupOf;
}

function outsideProjectError(kind: "shot" | "asset", ids: string[], projectId: string): Error {
  return new Error(`${kind} id${ids.length === 1 ? "" : "s"} ${ids.join(", ")} outside project ${projectId}`);
}

function overlaps(line: TranscriptLine, start: number, end: number): boolean {
  return line.endSec > start && line.startSec < end;
}

export function createPlanningTools(deps: PlanningToolsDeps) {
  const excluded = new Set(deps.excludedShotIds);

  return {
    async searchShots(input: { query: string; filters?: ShotFilters; limit?: number }): Promise<string[]> {
      const [vectors, loaded] = await Promise.all([
        deps.embedContent({ model: MODELS.embed, contents: [input.query], taskType: "RETRIEVAL_QUERY" }),
        deps.loadShots(deps.projectId),
      ]);
      const candidates = loaded.filter((shot) =>
        isEligible(shot, deps.projectId, excluded)
        && shot.embedding !== null
        && matchesFilters(shot, input.filters));
      const byId = new Map(candidates.map((shot) => [shot.id, shot]));
      const ranked = rankShots(
        vectors[0] ?? [],
        candidates.map((shot) => ({ id: shot.id, assetId: shot.assetId, embedding: shot.embedding ?? [] })),
        clampLimit(input.limit, SEARCH_DEFAULT, SEARCH_MAX),
      );
      return ranked.map(({ id }) => compactShotLine(byId.get(id)!));
    },

    async getShotDetails(input: { shotIds: string[] }): Promise<ShotDetails[]> {
      const loaded = await deps.loadShots(deps.projectId);
      const local = new Map(loaded.filter((shot) => shot.projectId === deps.projectId).map((shot) => [shot.id, shot]));
      const foreign = new Set(loaded.filter((shot) => shot.projectId !== deps.projectId).map((shot) => shot.id));
      const offences = input.shotIds.filter((id) => !local.has(id) || foreign.has(id));
      if (offences.length > 0) throw outsideProjectError("shot", offences, deps.projectId);

      return input.shotIds
        .slice(0, DETAIL_MAX)
        .filter((id) => !excluded.has(id))
        .map((id) => local.get(id)!)
        .filter((shot) => isEligible(shot, deps.projectId, excluded))
        .map(({ embedding: _embedding, ...details }) => details);
    },

    async getTranscript(input: { assetId: string; fromSec?: number; toSec?: number }): Promise<TranscriptLine[]> {
      const [asset, loadedShots] = await Promise.all([
        deps.loadAsset(deps.projectId, input.assetId),
        deps.loadShots(deps.projectId),
      ]);
      if (!asset || asset.projectId !== deps.projectId) {
        throw outsideProjectError("asset", [input.assetId], deps.projectId);
      }
      if (asset.kind === "photo" || !asset.transcript) return [];

      const assetShots = loadedShots.filter((shot) => shot.projectId === deps.projectId && shot.assetId === input.assetId);
      if (assetShots.length > 0 && assetShots.every((shot) => excluded.has(shot.id))) return [];
      const excludedRanges = assetShots
        .filter((shot) => excluded.has(shot.id) && shot.sourceStartSec !== null && shot.sourceEndSec !== null)
        .map((shot) => [shot.sourceStartSec!, shot.sourceEndSec!] as const);
      const from = input.fromSec ?? Number.NEGATIVE_INFINITY;
      const to = input.toSec ?? Number.POSITIVE_INFINITY;
      return asset.transcript
        .filter((line) => line.endSec > from && line.startSec < to)
        .filter((line) => excludedRanges.every(([start, end]) => !overlaps(line, start, end)))
        .slice(0, TRANSCRIPT_MAX);
    },
  };
}

export const planningToolDeclarations = [
  {
    name: "searchShots",
    description: "Search the current project's eligible shots by meaning and optional metadata filters.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        filters: {
          type: "object",
          properties: {
            day: { type: "string" },
            place: { type: "string" },
            eventId: { type: "string" },
            kind: { type: "string", enum: ["photo", "video"] },
          },
        },
        limit: { type: "number", description: "Maximum results; clamped to 30." },
      },
      required: ["query"],
    },
  },
  {
    name: "getShotDetails",
    description: "Get full analysis records for up to ten shots in the current project.",
    parametersJsonSchema: {
      type: "object",
      properties: { shotIds: { type: "array", items: { type: "string" } } },
      required: ["shotIds"],
    },
  },
  {
    name: "getTranscript",
    description: "Get up to 120 transcript lines for a current-project asset and optional time range.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        assetId: { type: "string" },
        fromSec: { type: "number" },
        toSec: { type: "number" },
      },
      required: ["assetId"],
    },
  },
] as const;

export const PLANNING_TOOL_DECLARATIONS = planningToolDeclarations;
