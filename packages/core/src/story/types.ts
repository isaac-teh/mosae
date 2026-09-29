/** A photo or clip the curator picked. `imageKey` resolves to a bundled or remote image in the client. */
export type Moment = {
  id: string;
  title: string;
  meta: string;
  tag: { emoji: string; label: string };
  imageKey: string;
  kind: "photo" | "video";
  durationLabel?: string;
  sourceInSec?: number;
  sourceOutSec?: number;
  badge?: string;
  selected: boolean;
  favorite: boolean;
  /** The moment's own shot (before any swap), for hiding it. Live plans only. */
  shotId?: string;
  /** Why the director chose this moment, shown on Review. */
  reason?: string;
  /** The user hid this moment's photo; it stays off until un-hidden. */
  hidden?: boolean;
};

/**
 * The user's Review edits, sent whole on every change. Undo re-sends the
 * previous value, so there is no separate undo call.
 */
export type PlanEdits = {
  deselectedMomentIds: string[];
  mustIncludeMomentIds: string[];
  hiddenShotIds: string[];
  /** Shots kept out of the film, including earlier director-chat exclusions. */
  excludedShotIds?: string[];
  /** Moment ids in the user's order; only moves within a chapter are honoured. */
  momentOrder: string[];
  /** momentId → the shot shown instead. */
  photoSwaps: Record<string, string>;
};

/** A photo kept out of the plan, and why. */
export type LeftOutPhoto = { shotId: string; thumbnailUrl: string; reason: string };

/** Another shot of the same moment the user can swap in. */
export type AlternativeShot = { shotId: string; thumbnailUrl: string; kind?: "photo" | "video" };

export type Chapter = {
  id: string;
  dayLabel: string;
  title: string;
  subtitle: string;
  badge: { label: string; tone: "neutral" | "milestone" };
  dotColor: string;
  momentIds: string[];
  /** Optional alternate captions/crops for the same moment in this chapter. */
  momentPresentation?: Record<string, Partial<Pick<Moment, "title" | "meta" | "imageKey" | "tag" | "kind" | "badge">>>;
};

export type StoryPlan = {
  planId: string;
  title: string;
  place: string;
  dateRange: string;
  coverImageKey: string;
  intro: { headline: string; body: string };
  archivalMatch: string[];
  timelineIntro: { headline: string; body: string; sequence: string };
  moments: Moment[];
  chapters: Chapter[];
  otherPhotoCount: number;
  albumName: string;
  suggestions: string[];
  estimatedFilmLabel: string;
  /** Fixture summaries can represent more captures than their sample cards. */
  totalMomentCount?: number;
  timelineOtherPhotoCount?: number;
  /** Photos the director or the user kept out, with reasons. */
  leftOut?: LeftOutPhoto[];
  /** The edits behind this version, for the next edit and for undo. */
  edits?: PlanEdits;
};

export type CreateOption = "film" | "album" | "share" | "apple-photos";

export type Cadence = { id: string; name: string; description: string };
export type Soundtrack = { id: string; name: string; description: string };
export type DurationChoice = { id: "30s" | "1m" | "2m" | "3m" | "4m" | "5m"; label: string; caption: string; seconds: number };

export type DirectionOptions = {
  note: string;
  rewrites: string[];
  cadences: Cadence[];
  soundtracks: Soundtrack[];
  durations: DurationChoice[];
  recommendedDuration: DurationChoice["id"];
  /** The tone the planner suggests from the photos' mood; preselected on Direct Film. */
  recommendedCadence: string;
  cadenceReason: string | null;
};

export type Direction = { note: string; cadenceId: string; soundtrackId: string | null; durationId: DurationChoice["id"] | null };

export type Film = {
  filmId: string;
  planId: string;
  version: number;
  title: string;
  subtitle: string;
  place: string;
  dateLabel: string;
  durationSec: number;
  posterKey: string;
  savePosterKey: string;
  videoKey: string;
  momentCount: number;
  audioLabel: string;
  shortcuts: { emoji: string; label: string }[];
  status: "ready" | "revising";
  /** The playable MP4 once rendered; null while the film is still being made. */
  videoUrl: string | null;
  /** True while the MP4 is still being made; the player waits on it. */
  rendering: boolean;
  /** Render pipeline progress, from zero to one, while rendering. */
  renderProgress?: number;
  /** Why the director placed what it placed, for the Review Film explanation. */
  reasons: string[];
};
