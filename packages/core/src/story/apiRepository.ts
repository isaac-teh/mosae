import { collection, doc, onSnapshot } from "firebase/firestore";
import { ensureSignedIn } from "../auth";
import { ApiError } from "../apiClient";
import { getCoreConfig } from "../config";
import { getFirestoreClient } from "../firebase";
import type { ChatInterpretRequest, DirectorPerson, StoryRepository } from "./repository";
import type { ProjectSummary } from "../chat/types";
import type { DirectionOptions, Film } from "./types";
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
  /** Every shot in the project, not only the ones this proposal uses. */
  totalShotCount: number;
  /** The version that accepts edits; null for a project that has none yet. */
  currentProposalId: string | null;
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
  // Swapped-in photos and left-out photos are shown too, so they need thumbnails.
  const neededShotIds = new Set([
    ...proposalRecord.moments.map((moment) => moment.shotId),
    ...Object.values(proposalRecord.constraints.photoSwaps ?? {}),
    ...(proposalRecord.leftOut ?? []).map((item) => item.shotId),
  ]);
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
    // A thumbnail that will not sign degrades one card; it must not turn the
    // whole review screen into an error page. Signing on Cloud Run needs
    // roles/iam.serviceAccountTokenCreator — see the README's operational limits.
    return [deps.getThumbnailUrl(projectId, stringField(asset.id, "asset id"))
      .catch((cause: unknown) => {
        console.warn(`Thumbnail unavailable for asset ${String(asset.id)}`, cause);
        return "";
      })
      .then((thumbnailUrl) => ({ id, kind, thumbnailUrl, eventLabel }))];
  }));

  return {
    proposal: proposalRecord,
    currentProposalId: typeof projectRecord.currentProposalId === "string" ? projectRecord.currentProposalId : null,
    // Every shot in the project, so "add from N other photos" counts the media
    // the proposal left out rather than the moments it kept.
    totalShotCount: shotValues.length,
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

export function createApiStoryRepository(
  options: ApiStoryRepositoryOptions,
  deps: ApiStoryRepositoryDeps = firebaseDeps,
): StoryRepository {
  if (!options.projectId) throw new Error("project_id_required");
  const projectId = options.projectId;
  const generationsPath = `/api/projects/${encodeURIComponent(projectId)}/generations`;
  const render = (source: ProjectionSources) => {
    const plan = projectProposal(source.proposal, source.project, source.shots, { totalShotCount: source.totalShotCount });
    const favorites = favoriteMomentIds(projectId, source.proposal.id);
    return { ...plan, moments: plan.moments.map((moment) => ({ ...moment, favorite: favorites.has(moment.id) })) };
  };

  return {
    getSummary: async (id) => await deps.request("GET", `/api/projects/${encodeURIComponent(id)}/summary`) as ProjectSummary,
    interpret: async (id, req) => await deps.request("POST", `/api/projects/${encodeURIComponent(id)}/chat/interpret`, req) as { reply: string; change: { kind: string; [key: string]: unknown } },
    getPeople: async (id) => {
      const root = `projects/${id}`;
      const [charactersValue, castValue, shotsValue, assetsValue, eventsValue] = await Promise.all([
        deps.request("GET", `/api/projects/${encodeURIComponent(id)}/characters`),
        deps.request("GET", `/api/projects/${encodeURIComponent(id)}/cast`).catch(() => null),
        deps.listenCollection(`${root}/shots`), deps.listenCollection(`${root}/assets`), deps.listenCollection(`${root}/events`),
      ]);
      const characters = record(charactersValue, "characters response");
      const cast = castValue ? record(castValue, "cast response").cast as RecordData | undefined : undefined;
      const castPeople = cast && Array.isArray(cast.people) ? cast.people as RecordData[] : [];
      const names = new Map(castPeople.map((person) => [String(person.personId), person]));
      const assets = new Map(assetsValue.map((value) => { const asset = record(value, "asset"); return [String(asset.id), asset] as const; }));
      const events = new Map(eventsValue.map((value) => { const event = record(value, "event"); return [String(event.id), event] as const; }));
      const groups = new Map<string, { shots: Set<string>; days: Set<number> }>();
      const shots = Array.isArray(characters.shots) ? characters.shots as RecordData[] : [];
      for (const shotValue of shots) {
        const shot = record(shotValue, "character shot");
        const shotId = String(shot.shotId);
        for (const faceValue of Array.isArray(shot.faces) ? shot.faces : []) {
          const face = record(faceValue, "face");
          if (typeof face.characterId !== "string" || !face.characterId) continue;
          const group = groups.get(face.characterId) ?? { shots: new Set<string>(), days: new Set<number>() };
          group.shots.add(shotId);
          const asset = assets.get(String(shot.assetId));
          const event = asset && events.get(String(asset.eventId));
          const day = /day\s+(\d+)/i.exec(String(event?.label ?? ""));
          if (day) group.days.add(Number(day[1]));
          groups.set(face.characterId, group);
        }
      }
      return [...groups.entries()].map(([personId, group]) => {
        const person = names.get(personId);
        return { personId, name: typeof person?.name === "string" ? person.name : null, role: typeof person?.role === "string" ? person.role : null, momentCount: group.shots.size, sampleShotIds: [...group.shots].slice(0, 4), days: [...group.days].sort((a, b) => a - b) } satisfies DirectorPerson;
      }).sort((a, b) => b.momentCount - a.momentCount);
    },
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
      // Edits make new versions, and only the current one accepts more edits.
      // A reload or an old link names an earlier version: open the current one.
      const current = source.currentProposalId;
      if (current && current !== planId) return render(await loadSources(deps, projectId, current));
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
    applyEdits: async (planId, edits) => {
      const source = await loadSources(deps, projectId, planId);
      const response = record(await deps.request(
        "PATCH",
        `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(planId)}/constraints`,
        edits,
      ), "constraint response");
      const revised = record(response.proposal, "revised proposal") as ProposalProjectionSource;
      // A swap can bring in a shot the old version never showed; reload so it has a thumbnail.
      const needsReload = Object.values(edits.photoSwaps).some((shotId) => !source.shots.some((shot) => shot.id === shotId));
      return render(needsReload ? await loadSources(deps, projectId, revised.id) : { ...source, proposal: revised });
    },
    getAlternatives: async (planId, momentId) => {
      const response = record(await deps.request(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(planId)}/moments/${encodeURIComponent(momentId)}/alternatives`,
      ), "alternatives response");
      const shots = Array.isArray(response.shots) ? response.shots as RecordData[] : [];
      return shots.map((shot) => ({ shotId: stringField(shot.shotId, "shot id"), thumbnailUrl: typeof shot.thumbUrl === "string" ? shot.thumbUrl : "" }));
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
    getDirectionOptions: async (planId) => await deps.request(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(planId)}/direction-options`,
    ) as DirectionOptions,
    directFilm: async (planId, direction) => {
      // Accept is idempotent on the server; a conflict only means another screen
      // got there first, which is no reason to stop directing the film.
      await deps.request("POST", `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(planId)}/accept`)
        .catch((error: unknown) => { if ((error as { status?: number }).status !== 409) throw error; });
      const settings = {
        schemaVersion: 1, id: newId(), projectId, version: 1, note: direction.note,
        cadenceId: direction.cadenceId, soundtrackId: direction.soundtrackId, durationId: direction.durationId,
        aspect: "9:16", captions: false,
      };
      return { filmId: await postGeneration({ proposalId: planId, settings }) };
    },
    getFilm: (filmId) => loadFilm(filmId),
    reviseFilm: async (filmId, request) => {
      const parent = await readGeneration(filmId);
      const settings = record(parent.settings, "generation settings");
      const childId = await postGeneration({
        proposalId: stringField(parent.proposalId, "proposal id"),
        parentGenerationId: filmId,
        settings: { ...settings, id: newId(), version: Number(settings.version ?? 1) + 1, note: request },
      });
      return loadFilm(childId);
    },
    saveFilm: async (filmId) => {
      // Compose starts the render itself, so by the time Save is tapped the film
      // is usually already rendering or saved; asking again would be refused.
      // Only a film still sitting at playable needs the render requested.
      if (isStatus(await readGeneration(filmId), "playable")) {
        await deps.request("POST", `${generationsPath}/${encodeURIComponent(filmId)}/render`);
      }
      const generation = record(await deps.listenUntil(
        `projects/${projectId}/generations/${filmId}`,
        (value) => isStatus(value, "saved", "failed"),
      ), "generation");
      if (generation.status === "failed") throw new Error(failureMessage(generation));
      return { downloadKey: await downloadUrl(filmId) };
    },
  };

  async function postGeneration(body: unknown): Promise<string> {
    const response = record(await deps.request("POST", generationsPath, body), "generation response");
    return stringField(record(response.generation, "generation").id, "generation id");
  }

  async function readGeneration(filmId: string): Promise<RecordData> {
    return record(await deps.listenDocument(`projects/${projectId}/generations/${filmId}`), "generation");
  }

  async function downloadUrl(filmId: string): Promise<string> {
    const response = record(await deps.request("GET", `${generationsPath}/${encodeURIComponent(filmId)}/download`), "download response");
    return stringField(response.downloadUrl, "download URL");
  }

  /** How many generations deep this one sits; the first film is version 1. */
  async function versionOf(generation: RecordData): Promise<number> {
    let version = 1;
    let parentId = generation.parentGenerationId;
    while (typeof parentId === "string" && parentId && version < 50) {
      const parent = await deps.listenDocument(`projects/${projectId}/generations/${parentId}`) as RecordData | null;
      if (!parent) break;
      version += 1;
      parentId = parent.parentGenerationId;
    }
    return version;
  }

  async function loadFilm(filmId: string): Promise<Film> {
    // Composing is the only state a film leaves on its own; wait it out here so
    // the review screen never renders a film that has no timeline yet.
    const generation = record(await deps.listenUntil(
      `projects/${projectId}/generations/${filmId}`,
      (value) => Boolean(value) && !isStatus(value, "composing"),
    ), "generation");
    if (generation.status === "failed") throw new Error(failureMessage(generation));

    const planId = stringField(generation.proposalId, "proposal id");
    const timeline = record(generation.timeline, "timeline");
    const clips = Array.isArray(timeline.videoClips) ? timeline.videoClips as RecordData[] : [];
    const [proposalValue, projectValue, shotValues, version, videoUrl] = await Promise.all([
      deps.listenDocument(`projects/${projectId}/storyProposals/${planId}`),
      deps.listenDocument(`projects/${projectId}`),
      deps.listenCollection(`projects/${projectId}/shots`),
      versionOf(generation),
      generation.status === "saved" ? downloadUrl(filmId) : Promise.resolve(null),
    ]);
    const proposalRecord = (proposalValue ?? {}) as RecordData;
    const projectRecord = (projectValue ?? {}) as RecordData;

    const firstShotId = (record(clips[0]?.source ?? {}, "clip source") as RecordData).shotId;
    const firstShot = shotValues.map((value) => value as RecordData).find((shot) => shot.id === firstShotId);
    const poster = typeof firstShot?.assetId === "string"
      ? await deps.getThumbnailUrl(projectId, firstShot.assetId).catch(() => "")
      : "";

    const durationSec = Number(timeline.durationSec ?? 0);
    const place = typeof projectRecord.place === "string" ? projectRecord.place : "";
    const dateLabel = [place, projectDateRange(projectRecord.dateRange)].filter(Boolean).join(" • ");
    const length = `${Math.floor(durationSec / 60)}:${String(Math.round(durationSec % 60)).padStart(2, "0")}`;
    return {
      filmId,
      planId,
      version,
      title: typeof proposalRecord.title === "string" ? proposalRecord.title : "Your film",
      subtitle: `Curated from ${clips.length} moments`,
      place,
      dateLabel,
      durationSec,
      posterKey: poster,
      savePosterKey: poster,
      videoKey: "",
      momentCount: clips.length,
      audioLabel: length,
      shortcuts: [],
      status: "ready",
      videoUrl,
      rendering: isStatus(generation, "playable", "rendering"),
      reasons: Array.isArray(generation.reasons) ? generation.reasons.filter((reason): reason is string => typeof reason === "string") : [],
    };
  }
}

function isStatus(value: unknown, ...statuses: string[]): boolean {
  return Boolean(value) && typeof value === "object" && statuses.includes(String((value as RecordData).status));
}

function failureMessage(generation: RecordData): string {
  const reasons = Array.isArray(generation.failureReasons) ? generation.failureReasons.filter((reason) => typeof reason === "string") : [];
  return reasons.join("; ") || "Film failed";
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}
