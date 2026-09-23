import { collection, doc, onSnapshot } from "firebase/firestore";
import { ensureSignedIn } from "../auth";
import { ApiError } from "../apiClient";
import { getCoreConfig } from "../config";
import { getFirestoreClient } from "../firebase";
import type { StoryRepository } from "./repository";
import {
  projectProposal,
  type ProjectProjectionSource,
  type ProposalProjectionSource,
  type ShotProjectionSource,
} from "./projectProposal";

type RecordData = Record<string, unknown>;

export type ApiStoryRepositoryDeps = {
  listenDocument(path: string, waitForExists?: boolean): Promise<unknown | null>;
  /**
   * Resolves with the first existing snapshot the predicate accepts. A document
   * that never satisfies it never resolves, so callers pass a terminal-state
   * predicate rather than waiting on a document that may never be written.
   */
  listenUntil(path: string, accept: (value: unknown) => boolean): Promise<unknown>;
  listenCollection(path: string): Promise<unknown[]>;
  getThumbnailUrl(projectId: string, assetId: string): Promise<string>;
  request(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<unknown>;
};

export type ApiStoryRepositoryOptions = { projectId: string };

type ProjectionSources = {
  proposal: ProposalProjectionSource;
  project: ProjectProjectionSource;
  shots: ShotProjectionSource[];
};

// Favorites are presentation-only. Keep them for the lifetime of the client
// session so repositories created by separate screens agree, while a full app
// reload intentionally starts a fresh presentation state.
const favoriteMomentIdsByProposal = new Map<string, Set<string>>();

function favoriteMomentIds(projectId: string, proposalId: string) {
  const key = `${projectId}\0${proposalId}`;
  let favorites = favoriteMomentIdsByProposal.get(key);
  if (!favorites) {
    favorites = new Set();
    favoriteMomentIdsByProposal.set(key, favorites);
  }
  return favorites;
}

const firebaseDeps: ApiStoryRepositoryDeps = {
  async listenDocument(path, waitForExists = false) {
    await ensureSignedIn();
    return new Promise((resolve, reject) => {
      let unsubscribe: (() => void) | undefined;
      const stop = () => queueMicrotask(() => unsubscribe?.());
      unsubscribe = onSnapshot(doc(getFirestoreClient(), path), (snapshot) => {
        if (!snapshot.exists()) {
          if (waitForExists) return;
          stop();
          resolve(null);
          return;
        }
        stop();
        resolve(snapshot.data());
      }, (error) => {
        stop();
        reject(error);
      });
    });
  },
  async listenUntil(path, accept) {
    await ensureSignedIn();
    return new Promise((resolve, reject) => {
      let unsubscribe: (() => void) | undefined;
      const stop = () => queueMicrotask(() => unsubscribe?.());
      unsubscribe = onSnapshot(doc(getFirestoreClient(), path), (snapshot) => {
        if (!snapshot.exists()) return;
        const value = snapshot.data();
        if (!accept(value)) return;
        stop();
        resolve(value);
      }, (error) => {
        stop();
        reject(error);
      });
    });
  },
  async listenCollection(path) {
    await ensureSignedIn();
    return new Promise((resolve, reject) => {
      let unsubscribe: (() => void) | undefined;
      const stop = () => queueMicrotask(() => unsubscribe?.());
      unsubscribe = onSnapshot(collection(getFirestoreClient(), path), (snapshot) => {
        stop();
        resolve(snapshot.docs.map((entry) => entry.data()));
      }, (error) => {
        stop();
        reject(error);
      });
    });
  },
  async getThumbnailUrl(projectId, assetId) {
    const response = record(await firebaseDeps.request(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/thumbnail`,
    ), "thumbnail response");
    return stringField(response.url, "thumbnail URL");
  },
  async request(method, path, body) {
    const user = await ensureSignedIn();
    const response = await fetch(`${getCoreConfig().apiBaseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const data = json && typeof json === "object" ? json as RecordData : {};
      throw new ApiError(response.status, typeof data.error === "string" ? data.error : "request_failed");
    }
    return json;
  },
};

function record(value: unknown, name: string): RecordData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name} record`);
  return value as RecordData;
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${name}`);
  return value;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoDate(value: unknown): { year: string; month: number; day: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: match[1], month, day };
}

function projectDateRange(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const range = value as RecordData;
  const start = isoDate(range.start);
  const end = isoDate(range.end);
  if (!start || !end) return null;
  if (start.year === end.year && start.month === end.month) {
    return start.day === end.day
      ? `${MONTHS[start.month - 1]} ${start.day}, ${start.year}`
      : `${MONTHS[start.month - 1]} ${start.day}–${end.day}, ${start.year}`;
  }
  const startLabel = `${MONTHS[start.month - 1]} ${start.day}${start.year === end.year ? "" : `, ${start.year}`}`;
  return `${startLabel}–${MONTHS[end.month - 1]} ${end.day}, ${end.year}`;
}

async function loadSources(deps: ApiStoryRepositoryDeps, projectId: string, proposalId: string): Promise<ProjectionSources> {
  const root = `projects/${projectId}`;
  const [projectValue, proposalValue, shotValues, assetValues, eventValues] = await Promise.all([
    deps.listenDocument(root),
    deps.listenDocument(`${root}/storyProposals/${proposalId}`, true),
    deps.listenCollection(`${root}/shots`),
    deps.listenCollection(`${root}/assets`),
    deps.listenCollection(`${root}/events`),
  ]);
  const projectRecord = record(projectValue, "project");
  const proposalRecord = record(proposalValue, "proposal") as ProposalProjectionSource;
  const assets = new Map(assetValues.map((value) => {
    const asset = record(value, "asset");
    return [stringField(asset.id, "asset id"), asset] as const;
  }));
  const events = new Map(eventValues.map((value) => {
    const event = record(value, "event");
    return [stringField(event.id, "event id"), event] as const;
  }));
  const neededShotIds = new Set(proposalRecord.moments.map((moment) => moment.shotId));
  const shots = await Promise.all(shotValues.flatMap((value) => {
    const shot = record(value, "shot");
    const id = stringField(shot.id, "shot id");
    if (!neededShotIds.has(id)) return [];
    const asset = assets.get(stringField(shot.assetId, "shot asset id"));
    if (!asset) throw new Error(`Missing asset for shot ${id}`);
    const eventId = typeof asset.eventId === "string" ? asset.eventId : null;
    const event = eventId ? events.get(eventId) : undefined;
    const eventLabel = event && typeof event.label === "string" ? event.label : "Undated";
    const kind = shot.mediaType === "video" ? "video" as const : "photo" as const;
    return [deps.getThumbnailUrl(projectId, stringField(asset.id, "asset id")).then((thumbnailUrl) => ({ id, kind, thumbnailUrl, eventLabel }))];
  }));

  return {
    proposal: proposalRecord,
    project: {
      id: stringField(projectRecord.id, "project id"),
      title: typeof projectRecord.title === "string" ? projectRecord.title : null,
      place: typeof projectRecord.place === "string" ? projectRecord.place : null,
      dateRange: projectDateRange(projectRecord.dateRange),
    },
    shots,
  };
}

const PLAN_FAILED = "Couldn't update your moments. Please try again.";

/**
 * Waits on the plan job, not on the proposal it would write. A failed job never
 * writes one, so waiting for the document left the review screen showing
 * "Updating…" forever with every control disabled. This mirrors how Tell AI the
 * Story watches the job and surfaces its reason.
 */
async function awaitPlanJob(deps: ApiStoryRepositoryDeps, projectId: string, jobId: string): Promise<void> {
  const value = await deps.listenUntil(
    `projects/${projectId}/jobs/${jobId}`,
    (snapshot) => {
      const status = (snapshot as RecordData | null)?.status;
      return status === "succeeded" || status === "failed";
    },
  );
  const job = record(value, "plan job");
  if (job.status !== "failed") return;
  throw new Error(typeof job.reason === "string" && job.reason ? job.reason : PLAN_FAILED);
}

function unavailable(operation: string): Promise<never> {
  return Promise.reject(new Error(`${operation}_not_available`));
}

export function createApiStoryRepository(
  options: ApiStoryRepositoryOptions,
  deps: ApiStoryRepositoryDeps = firebaseDeps,
): StoryRepository {
  if (!options.projectId) throw new Error("project_id_required");
  const projectId = options.projectId;
  const render = (source: ProjectionSources) => {
    const plan = projectProposal(source.proposal, source.project, source.shots);
    const favorites = favoriteMomentIds(projectId, source.proposal.id);
    return { ...plan, moments: plan.moments.map((moment) => ({ ...moment, favorite: favorites.has(moment.id) })) };
  };

  return {
    createPlan: async (storyText, _mediaRefs) => {
      const response = record(await deps.request("POST", `/api/projects/${encodeURIComponent(projectId)}/story-intents`, {
        text: storyText,
        focus: [],
      }), "create plan response");
      const job = record(response.job, "plan job");
      return { planId: stringField(job.proposalId, "proposal id") };
    },
    getPlan: async (planId) => {
      const source = await loadSources(deps, projectId, planId);
      return render(source);
    },
    setMomentSelected: async (planId, momentId, selected) => {
      const source = await loadSources(deps, projectId, planId);
      if (!source.proposal.moments.some((moment) => moment.id === momentId)) throw new Error(`Unknown moment ${momentId}`);
      const deselected = new Set(source.proposal.constraints.deselectedMomentIds);
      if (selected) deselected.delete(momentId);
      else deselected.add(momentId);
      const mustIncludeMomentIds = source.proposal.constraints.mustIncludeMomentIds ?? [];
      const response = record(await deps.request(
        "PATCH",
        `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(planId)}/constraints`,
        {
          deselectedMomentIds: [...deselected],
          mustIncludeMomentIds: selected ? mustIncludeMomentIds : mustIncludeMomentIds.filter((id) => id !== momentId),
        },
      ), "constraint response");
      const revised = record(response.proposal, "revised proposal") as ProposalProjectionSource;
      return render({ ...source, proposal: revised });
    },
    setMomentFavorite: async (planId, momentId, favorite) => {
      const source = await loadSources(deps, projectId, planId);
      if (!source.proposal.moments.some((moment) => moment.id === momentId)) throw new Error(`Unknown moment ${momentId}`);
      const favorites = favoriteMomentIds(projectId, source.proposal.id);
      if (favorite) favorites.add(momentId);
      else favorites.delete(momentId);
      return render(source);
    },
    reviseMoments: async (planId, request) => {
      const response = record(await deps.request(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(planId)}/feedback`,
        { feedback: request },
      ), "feedback response");
      const job = record(response.job, "plan job");
      const nextProposalId = stringField(job.proposalId, "proposal id");
      await awaitPlanJob(deps, projectId, stringField(job.id, "plan job id"));
      const source = await loadSources(deps, projectId, nextProposalId);
      return render(source);
    },
    chooseCreateOption: async (planId, option) => {
      if (option !== "film") return { available: false };
      await deps.request(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(planId)}/accept`,
      );
      return { available: true };
    },
    getDirectionOptions: () => unavailable("get_direction_options"),
    directFilm: () => unavailable("direct_film"),
    getFilm: () => unavailable("get_film"),
    reviseFilm: () => unavailable("revise_film"),
    saveFilm: () => unavailable("save_film"),
  };
}
