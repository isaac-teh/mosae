import type {
  Cadence,
  Chapter,
  CreateOption,
  Direction,
  DirectionOptions,
  Film,
  Moment,
  StoryPlan,
  Soundtrack,
  DurationChoice,
} from "./types";
import type { StoryRepository } from "./repository";

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
  },
  {
    id: "chapter-2",
    dayLabel: "Day 2 - Exploring Tokyo & Street Flavours",
    title: "Komorebi Cafe & Street Markets",
    subtitle: "14 moments",
    badge: { label: "Chapter 2", tone: "neutral" },
    dotColor: "#855300",
    momentIds: ["moment-2", "moment-3"],
  },
  {
    id: "chapter-3",
    dayLabel: "Day 3 - Mei's 7th Birthday Celebration",
    title: "Birthday Morning & Cafe Celebration",
    subtitle: "16 moments",
    badge: { label: "Key Milestone", tone: "milestone" },
    dotColor: "#a83212",
    momentIds: ["moment-1"],
  },
  {
    id: "chapter-4",
    dayLabel: "Day 4 - Kyoto & Ancient Shrines",
    title: "Torii Gates & Traditional Tea Shops",
    subtitle: "14 moments",
    badge: { label: "Chapter 4", tone: "neutral" },
    dotColor: "#006579",
    momentIds: ["moment-3"],
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
  moments: moments.map((m) => ({ ...m, selected: true, favorite: false })),
  otherPhotoCount: 216,
  albumName: "Japan Trip",
  suggestions: [
    "+ Add more photos of Mei",
    "Show more of the food we tried",
    "Remove similar photos",
    "Include more family photos from Kyoto",
  ],
  estimatedFilmLabel: "~2 min 15 sec film",
};

const cadences: Cadence[] = [
  { id: "cadence-warm", name: "Warm & Nostalgic", description: "Soft acoustic guitar • Kodachrome warmth" },
  { id: "cadence-bright", name: "Bright & Playful", description: "Ukulele & bright daylight • Cheerful" },
  { id: "cadence-dramatic", name: "Dramatic & Cinematic", description: "Strings & high contrast • Epic" },
];

const soundtracks: Soundtrack[] = [
  { id: "st-ukulele", name: "Okinawa Ukulele & String Trio", description: "Acoustic Heirloom • 2:14 min" },
  { id: "st-piano", name: "Piano & Ambient", description: "Intimate Heirloom • 2:14 min" },
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
};

const baseFilm: Film = {
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
};

export interface FixtureOptions {
  delayMs?: number;
}

export function createFixtureStoryRepository(opts?: FixtureOptions): StoryRepository {
  const delayMs = opts?.delayMs ?? 400;

  let planState: StoryPlan = structuredClone(basePlan);
  let filmState: Film = structuredClone(baseFilm);

  function delayed<T>(fn: () => T): Promise<T> {
    return new Promise<T>((resolve) => {
      setTimeout(() => resolve(fn()), delayMs);
    });
  }

  return {
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
