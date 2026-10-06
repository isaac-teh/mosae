import type {
  Cadence,
  Chapter,
  CreateOption,
  Direction,
  PlanEdits,
  DirectionOptions,
  Film,
  Moment,
  StoryPlan,
  Soundtrack,
  DurationChoice,
  EditConversationTurn,
} from "./types";
import type { StoryRepository } from "./repository";
import type { FilmEdits, FilmRender } from "./repository";
import { applyEdits, parseTimeline } from "@mosae/contracts";

const PLAN_ID = "demo";
const FILM_ID = "demo-film";

const moments: Moment[] = [
  {
    id: "moment-1",
    title: "Mai's 7th Birthday Song",
    meta: "Komorebi Coffee & Bakes • 4:12 PM",
    tag: { emoji: "🎂", label: "Milestone Moment" },
    imageKey: "birthday-song",
    kind: "photo",
    selected: true,
    favorite: false,
  },
  {
    id: "moment-2",
    title: "First Taste of Strawberry",
    meta: "Traditional Tea Shop",
    tag: { emoji: "🍓", label: "Food & Taste" },
    imageKey: "strawberry-mochi",
    kind: "photo",
    selected: true,
    favorite: false,
  },
  {
    id: "moment-3",
    title: "Torii Gates & High Skies",
    meta: "Fushimi Inari Shrine",
    tag: { emoji: "⛩️", label: "Family Joy" },
    imageKey: "torii-gates",
    kind: "photo",
    selected: true,
    favorite: false,
  },
  {
    id: "moment-4",
    title: "Dusk Along Yanaka Ginza",
    meta: "Evening Stroll • Tokyo",
    tag: { emoji: "🏮", label: "Golden Hour Walk" },
    imageKey: "yanaka-dusk",
    kind: "photo",
    badge: "Heirloom",
    selected: true,
    favorite: false,
  },
];

const chapters: Chapter[] = [
  {
    id: "chapter-1",
    dayLabel: "Day 1 - Arriving & Tokyo Nights",
    title: "Narita Express to Yanaka",
    subtitle: "8 moments",
    badge: { label: "Chapter 1", tone: "neutral" },
    dotColor: "#a83212",
    momentIds: ["moment-4"],
    momentPresentation: { "moment-4": { imageKey: "timeline-lantern-stroll", meta: "First evening walk under retro shop lanterns", tag: { emoji: "🏮", label: "Dusk Along Yanaka Ginza" } } },
  },
  {
    id: "chapter-2",
    dayLabel: "Day 2 - Exploring Tokyo & Street Flavours",
    title: "Komorebi Cafe & Street Markets",
    subtitle: "14 moments",
    badge: { label: "Chapter 2", tone: "neutral" },
    dotColor: "#855300",
    momentIds: ["moment-2", "moment-4"],
    momentPresentation: {
      "moment-2": { imageKey: "timeline-strawberry", title: "Market Sweet Discovery", meta: "11:30 AM • Yanaka Alley", tag: { emoji: "🍓", label: "Street Food Taste" } },
      "moment-4": { imageKey: "timeline-lantern-stroll", title: "Giggling Down the Arcade", meta: "3:45 PM • Live Capture", kind: "video", badge: undefined, tag: { emoji: "🎬", label: "Burst 0:18" } },
    },
  },
  {
    id: "chapter-3",
    dayLabel: "Day 3 - Mei's 7th Birthday Celebration",
    title: "Birthday Morning & Cafe Celebration",
    subtitle: "16 moments",
    badge: { label: "Key Milestone", tone: "milestone" },
    dotColor: "#a83212",
    momentIds: ["moment-1"],
    momentPresentation: { "moment-1": { imageKey: "timeline-birthday", meta: "Komorebi Coffee & Bakes • 4:12 PM • 4k Archival Video", tag: { emoji: "🎂", label: "Candle & Birthday Song" } } },
  },
  {
    id: "chapter-4",
    dayLabel: "Day 4 - Kyoto & Ancient Shrines",
    title: "Torii Gates & Traditional Tea Shops",
    subtitle: "14 moments",
    badge: { label: "Chapter 4", tone: "neutral" },
    dotColor: "#006579",
    momentIds: ["moment-3", "moment-2"],
    momentPresentation: {
      "moment-3": { imageKey: "timeline-torii", title: "Shoulders at High Torii", meta: "Fushimi Inari • 10:15 AM", tag: { emoji: "⛩️", label: "Torii Path" } },
      "moment-2": { imageKey: "timeline-strawberry", title: "Sweet Shop Keepsake", meta: "Gion Teahouse • 2:40 PM", tag: { emoji: "🍵", label: "Kyoto Mochi" } },
    },
  },
];

const basePlan: StoryPlan = {
  planId: PLAN_ID,
  title: "Mai's 7th Birthday in Japan",
  place: "Tokyo & Kyoto",
  dateRange: "Oct 14–18, 2024",
  coverImageKey: "birthday-song",
  intro: {
    headline: "We found 32 moments that tell your story.",
    body: "Selected for genuine smiles, warm lighting, and key birthday milestones. Tap any photo to deselect or add more.",
  },
  archivalMatch: ["Mei laughing", "Birthday cake", "Kyoto mochi", "Golden hour walk"],
  timelineIntro: {
    headline: "We found 52 moments that tell your story.",
    body: "Organised chronologically from Tokyo to Kyoto, highlighting Mei's birthday, local street food, and your favourite family walks.",
    sequence: "4 Trip Chapters • Narita to Fushimi Inari • Emotional Arc preserved",
  },
  chapters,
  moments: moments.map((m, index) => ({ ...m, shotId: `fixture-${index + 1}`, selected: true, favorite: false })),
  otherPhotoCount: 216,
  albumName: "Japan Trip",
  suggestions: [
    "+ Add more photos of Mei",
    "Show more of the food we tried",
    "Remove similar photos",
    "Include more family photos from Kyoto",
  ],
  estimatedFilmLabel: "~2 min 15 sec film",
  totalMomentCount: 52,
  timelineOtherPhotoCount: 164,
};

const cadences: Cadence[] = [
  { id: "cadence-warm", name: "Warm & Nostalgic", description: "Soft acoustic guitar • Kodachrome warmth" },
  { id: "cadence-bright", name: "Bright & Playful", description: "Ukulele & bright daylight • Cheerful" },
  { id: "cadence-dramatic", name: "Dramatic & Cinematic", description: "Strings & high contrast • Epic" },
];

const soundtracks: Soundtrack[] = [
  { id: "st-ukulele", name: "Okinawa Ukulele & String Trio", description: "Acoustic Heirloom • 2:14 min", mood: "Acoustic Heirloom", durationSec: 134 },
  { id: "st-piano", name: "Piano & Ambient", description: "Intimate Heirloom • 2:14 min", mood: "Intimate Heirloom", durationSec: 134 },
];

const durations: DurationChoice[] = [
  { id: "30s", label: "30s", caption: "Teaser", seconds: 30 },
  { id: "1m", label: "1m", caption: "Short", seconds: 60 },
  { id: "2m", label: "2m", caption: "Story • Rec", seconds: 120 },
  { id: "3m", label: "3m", caption: "Full Trip", seconds: 180 },
  { id: "5m", label: "5m", caption: "Feature", seconds: 300 },
];

const note = "Make it feel exciting and warm. Start with us arriving in Tokyo, build up to the birthday cake celebration, and finish with our quiet Kyoto stroll.";

const directionOptions: DirectionOptions = {
  note,
  rewrites: [
    "More upbeat music",
    "Extend the cake scene",
    "Shorter cut",
  ],
  cadences,
  soundtracks,
  durations,
  recommendedDuration: "2m",
  recommendedCadence: cadences[0].id,
  cadenceReason: null,
};

const baseFilm: Film = {
  aspect: "9:16",
  filmId: FILM_ID,
  planId: PLAN_ID,
  version: 1,
  title: "Mei's 7th Birthday in Japan",
  subtitle: "Curated from 52 captured moments",
  place: "Tokyo & Kyoto",
  dateLabel: "Tokyo & Kyoto • March 2026",
  durationSec: 130,
  posterKey: "birthday-song",
  savePosterKey: "save-poster",
  videoKey: "kyoto-mochi",
  momentCount: 32,
  audioLabel: "4K Master Audio • 2:10",
  shortcuts: [
    { emoji: "✂️", label: "Shorter cut" },
    { emoji: "🎵", label: "Upbeat music" },
    { emoji: "🎂", label: "Extend cake scene" },
    { emoji: "📀", label: "4K Master Audio • 2:10" },
  ],
  status: "ready",
  videoUrl: null,
  rendering: false,
  reasons: [],
};

export interface FixtureOptions {
  delayMs?: number;
}

export function createFixtureStoryRepository(opts?: FixtureOptions): StoryRepository {
  const delayMs = opts?.delayMs ?? 400;

  let planState: StoryPlan = structuredClone(basePlan);
  let filmState: Film = structuredClone(baseFilm);
  const editDocuments = new Map<string, FilmEdits>();
  const editRenders = new Map<string, FilmRender>();
  const editConversations = new Map<string, EditConversationTurn[]>();
  const browserEditKey = (projectId: string, generationId: string) => `mosae:fixture-editor:${projectId}/${generationId}`;
  const browserConversationKey = (projectId: string, generationId: string) => `${browserEditKey(projectId, generationId)}/conversation`;
  const browserRenderKey = (projectId: string, generationId: string, revision: number) => `${browserEditKey(projectId, generationId)}/render/${revision}`;
  const readBrowserValue = <T,>(key: string): T | undefined => {
    try {
      return typeof window === "undefined" ? undefined : JSON.parse(window.localStorage.getItem(key) ?? "null") as T | undefined;
    } catch { return undefined; }
  };
  const writeBrowserValue = (key: string, value: unknown) => {
    try { if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage is optional in restricted browser contexts */ }
  };

  function delayed<T>(fn: () => T): Promise<T> {
    return new Promise<T>((resolve) => {
      setTimeout(() => resolve(fn()), delayMs);
    });
  }

  return {
    listFilms: async () => [{ projectId: "fixture", filmId: FILM_ID, planId: PLAN_ID, title: baseFilm.title, month: "Mar 2026", duration: "2:10", posterUrl: "", justSaved: false, status: "film-ready", demo: true }],
    getProjectResume: async (projectId) => projectId === "fixture"
      ? { proposalId: PLAN_ID, storyText: "Yes, our Japan trip", generationId: FILM_ID, generationStatus: "playable" }
      : { proposalId: null, storyText: null, generationId: null, generationStatus: null },
    getSummary: async () => ({ total: 52, photos: 52, clips: 0, days: 4, dateRange: null, places: ["Tokyo", "Kyoto"], country: "Japan", season: "March", processed: { ingested: 52, understood: 52, faces: 52 }, ready: { summary: true, faces: true, plan: true } }),
    interpret: async () => ({ reply: "I didn't catch that. Pick one below, or say it another way.", change: { kind: "unclear" } }),
    getPeople: async (projectId: string) => projectId === "face-merge-fixture" ? [
      { personId: "face-merge-first", name: null, role: "child", ageBand: "child" as const, momentCount: 4, sampleShotIds: ["merge-a1", "merge-a2"], sampleFaces: [{ shotId: "merge-a1", uri: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%23efd8c5'/%3E%3Ccircle cx='48' cy='48' r='28' fill='%239b674f'/%3E%3C/svg%3E", bbox: [0, 0, 1, 1] as [number, number, number, number] }], days: [1] },
      { personId: "face-merge-second", name: null, role: "child", ageBand: "child" as const, momentCount: 3, sampleShotIds: ["merge-b1", "merge-b2"], sampleFaces: [{ shotId: "merge-b1", uri: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%23efd8c5'/%3E%3Ccircle cx='48' cy='48' r='28' fill='%239b674f'/%3E%3C/svg%3E", bbox: [0, 0, 1, 1] as [number, number, number, number] }], days: [2] },
    ] : [],
    createPlan: async (storyText: string, mediaRefs: string[]) => {
      return delayed(() => ({ planId: PLAN_ID }));
    },

    getPlan: async (planId: string) => {
      if (planId !== PLAN_ID) throw new Error(`Unknown plan ${planId}`);
      return structuredClone(planState);
    },

    setMomentSelected: async (planId: string, momentId: string, selected: boolean) => {
      if (planId !== PLAN_ID) throw new Error(`Unknown plan ${planId}`);
      const moment = planState.moments.find((m) => m.id === momentId);
      if (moment) moment.selected = selected;
      return structuredClone(planState);
    },

    applyEdits: async (planId: string, edits: PlanEdits) => {
      if (planId !== PLAN_ID) throw new Error(`Unknown plan ${planId}`);
      const deselected = new Set(edits.deselectedMomentIds);
      const rank = new Map(edits.momentOrder.map((id, index) => [id, index]));
      planState = {
        ...planState,
        edits: structuredClone(edits),
        moments: planState.moments.map((moment) => ({ ...moment, selected: !deselected.has(moment.id) })),
        chapters: planState.chapters.map((chapter) => ({
          ...chapter,
          momentIds: [...chapter.momentIds].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity)),
        })),
      };
      return delayed(() => structuredClone(planState));
    },

    getAlternatives: async (planId: string, momentId: string) => {
      if (planId !== PLAN_ID || !planState.moments.some((moment) => moment.id === momentId)) return [];
      return [{ shotId: "fixture-alt", thumbnailUrl: "demo:timeline-strawberry", kind: "photo" as const }];
    },

    setMomentFavorite: async (planId: string, momentId: string, favorite: boolean) => {
      if (planId !== PLAN_ID) throw new Error(`Unknown plan ${planId}`);
      const moment = planState.moments.find((m) => m.id === momentId);
      if (moment) moment.favorite = favorite;
      return structuredClone(planState);
    },

    reviseMoments: async (planId: string, request: string) => {
      if (planId !== PLAN_ID) throw new Error(`Unknown plan ${planId}`);
      return structuredClone(planState);
    },

    chooseCreateOption: async (planId: string, option: CreateOption) => {
      if (planId !== PLAN_ID) throw new Error(`Unknown plan ${planId}`);
      return { available: option === "film" };
    },

    getDirectionOptions: async (planId: string) => {
      if (planId !== PLAN_ID) throw new Error(`Unknown plan ${planId}`);
      return structuredClone(directionOptions);
    },

    directFilm: async (planId: string, direction: Direction) => {
      if (planId !== PLAN_ID) throw new Error(`Unknown plan ${planId}`);
      filmState = structuredClone(baseFilm);
      return { filmId: FILM_ID };
    },

    getFilm: async (filmId: string) => {
      if (filmId !== FILM_ID) throw new Error(`Unknown film ${filmId}`);
      return structuredClone(filmState);
    },

    getFilmTimeline: async (projectId) => {
      const sourceIds = ["fixture-1", "fixture-2", "fixture-3", "fixture-4"];
      const photos = ["timeline-birthday", "timeline-strawberry", "timeline-torii", "timeline-lantern-stroll"];
      return {
        timeline: parseTimeline({
          schemaVersion: 2, projectId: projectId || "fixture", mode: "memory", aspect: "9:16", fps: 30,
          durationSec: 22,
          chapters: [{ title: "Opening", startSec: 0 }, { title: "Candid moments", startSec: 7 }, { title: "Closing", startSec: 16 }],
          videoClips: [
            { id: "clip-1", source: { kind: "video", shotId: "fixture-video", sourceInSec: 2, sourceOutSec: 5, sourceDurationSec: 8 }, startSec: 0, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } },
            { kind: "collage", clipId: "collage-1", startSec: 3, durationSec: 4, transitionIn: { kind: "cut", durationSec: 0 }, spec: { layoutId: "photo-table", slots: sourceIds.map((shotId, index) => ({ slotId: `slot-${index + 1}`, shotId, kind: "photo" })), motionId: "stack-deal", effectId: "vignette", seed: "editor-fixture", durationSec: 4 } },
            ...["fixture-2", "fixture-3", "fixture-4", "fixture-1", "fixture-3"].map((shotId, index) => ({ id: `clip-${index + 3}`, source: { kind: "photo", shotId }, startSec: index * 3 + 7, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } })),
          ],
          audioClips: [], captions: [],
        }),
        sources: { ...Object.fromEntries(sourceIds.map((shotId, index) => [shotId, `demo:${photos[index]}`])), "fixture-video": "demo:film", "fixture-video-extra": "demo:film", "st-ukulele": "demo:music-acoustic-demo", "st-piano": "demo:music-piano-demo" },
        thumbnails: { "fixture-video": "demo:timeline-birthday" },
        unusedMedia: [{ shotId: "fixture-video-extra", kind: "video", thumbnailUrl: "demo:timeline-birthday", previewUrl: "demo:film", date: "2026-03-12", eventLabel: "Birthday movie", sourceInSec: 0, sourceOutSec: 8 }],
      };
    },

    getEdits: async (projectId, generationId) => structuredClone(editDocuments.get(`${projectId}/${generationId}`) ?? readBrowserValue<FilmEdits>(browserEditKey(projectId, generationId)) ?? { revision: 0, ops: [], updatedAt: null }),
    getEditConversation: async (projectId, generationId) => structuredClone(editConversations.get(`${projectId}/${generationId}`) ?? readBrowserValue<EditConversationTurn[]>(browserConversationKey(projectId, generationId)) ?? []),
    acknowledgeEditInterpretation: async (projectId, generationId, requestId, revision) => {
      const key = `${projectId}/${generationId}`;
      const turns = editConversations.get(key) ?? readBrowserValue<EditConversationTurn[]>(browserConversationKey(projectId, generationId)) ?? [];
      const updated = turns.map((turn) => turn.requestId === requestId ? { ...turn, status: "applied" as const, appliedRevision: revision } : turn);
      editConversations.set(key, updated);
      writeBrowserValue(browserConversationKey(projectId, generationId), updated);
    },
    interpretEdit: async (projectId, generationId, text, revision, context) => {
      const requestId = context?.requestId ?? globalThis.crypto.randomUUID();
      const reply = "Applied a longer hold to the opening photo.";
      const ops = [{ op: "setPhotoDuration" as const, clipId: "clip-3", sec: 4 }];
      const key = `${projectId}/${generationId}`;
      const turns = editConversations.get(key) ?? readBrowserValue<EditConversationTurn[]>(browserConversationKey(projectId, generationId)) ?? [];
      const turn: EditConversationTurn = { requestId, user: text.slice(0, 2000), reply, kind: "edit", revision, status: "pending" };
      const updated = [...turns.filter((item) => item.requestId !== requestId), turn].slice(-8);
      editConversations.set(key, updated);
      writeBrowserValue(browserConversationKey(projectId, generationId), updated);
      return { kind: "edit", requestId, baseRevision: revision, reply, ops };
    },
    saveEdits: async (projectId, generationId, revision, ops) => {
      const key = `${projectId}/${generationId}`;
      const current = editDocuments.get(key) ?? readBrowserValue<FilmEdits>(browserEditKey(projectId, generationId)) ?? { revision: 0, ops: [], updatedAt: null };
      if (revision !== current.revision + 1) throw new Error("stale_revision");
      const document = { revision, ops: structuredClone(ops), updatedAt: Date.now() };
      editDocuments.set(key, document);
      writeBrowserValue(browserEditKey(projectId, generationId), document);
      return structuredClone(document);
    },
    renderRevision: async (projectId, generationId, revision) => {
      const saved = editDocuments.get(`${projectId}/${generationId}`) ?? readBrowserValue<FilmEdits>(browserEditKey(projectId, generationId)) ?? { revision: 0, ops: [], updatedAt: null };
      if (saved.revision !== revision) throw new Error("stale_revision");
      const { timeline: firstCut } = await createFixtureStoryRepository({ delayMs: 0 }).getFilmTimeline(projectId, generationId);
      const applied = applyEdits(firstCut, saved.ops);
      if (!applied.ok) throw new Error("render_input_invalid");
      const result = { revision, status: "ready" as const, downloadUrl: "film", inputOps: structuredClone(saved.ops), timeline: applied.timeline };
      editRenders.set(`${projectId}/${generationId}/${revision}`, result);
      writeBrowserValue(browserRenderKey(projectId, generationId, revision), result);
      return { renderId: `${generationId}-edit-${revision}` };
    },
    getRender: async (projectId, generationId, revision) => structuredClone(editRenders.get(`${projectId}/${generationId}/${revision}`) ?? readBrowserValue<FilmRender>(browserRenderKey(projectId, generationId, revision)) ?? { revision, status: "pending" }),

    reviseFilm: async (filmId: string, request: string) => {
      if (filmId !== FILM_ID) throw new Error(`Unknown film ${filmId}`);
      filmState = { ...filmState, version: filmState.version + 1, status: "revising" as "revising" };
      return structuredClone(filmState);
    },

    saveFilm: async (filmId: string) => {
      if (filmId !== FILM_ID) throw new Error(`Unknown film ${filmId}`);
      return { downloadKey: "film" };
    },
  };
}
