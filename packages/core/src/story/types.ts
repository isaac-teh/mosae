/** A photo or clip the curator picked. `imageKey` resolves to a bundled or remote image in the client. */
export type Moment = {
  id: string;
  title: string;
  meta: string;
  tag: { emoji: string; label: string };
  imageKey: string;
  kind: "photo" | "video";
  durationLabel?: string;
  badge?: string;
  selected: boolean;
  favorite: boolean;
};

export type Chapter = {
  id: string;
  dayLabel: string;
  title: string;
  subtitle: string;
  badge: { label: string; tone: "neutral" | "milestone" };
  dotColor: string;
  momentIds: string[];
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
};

export type CreateOption = "film" | "album" | "share" | "apple-photos";

export type Cadence = { id: string; name: string; description: string };
export type Soundtrack = { id: string; name: string; description: string };
export type DurationChoice = { id: "30s" | "1m" | "2m" | "3m" | "5m"; label: string; caption: string; seconds: number };

export type DirectionOptions = {
  note: string;
  rewrites: string[];
  cadences: Cadence[];
  soundtracks: Soundtrack[];
  durations: DurationChoice[];
  recommendedDuration: DurationChoice["id"];
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
};
