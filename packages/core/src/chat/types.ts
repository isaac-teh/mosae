import type { Film, StoryPlan } from "../story/types.js";
import type { PersonAgeBand } from "./personChips.js";

export type ProjectSummary = {
  total: number;
  photos: number;
  clips: number;
  days: number;
  dateRange: { from: string; to: string } | null;
  places: string[];
  country: string | null;
  season: string | null;
  processed: { ingested: number; understood: number; faces: number };
  orientation?: { portrait: number; landscape: number; square: number; suggested: "9:16" | "16:9" | null };
  upload?: { expected: number; settled: number; failed: number; cancelled: number; closed: boolean };
  ready: { summary: boolean; faces: boolean; plan: boolean; story?: boolean; film?: boolean };
  assetStatuses?: { assetId: string; kind: "photo" | "video"; status: "uploaded" | "ingested" | "understood" | "failed" }[];
  videoStatuses?: { assetId: string; status: "processing" | "ready" | "failed"; progress: number }[];
};

export type ChatInput = {
  localMediaPending?: boolean;
  uploadFailuresAcknowledged?: boolean;
  summary: ProjectSummary | null;
  intent: { text: string } | null;
  mentionedPeople?: string[];
  storySummary?: string;
  people: { personId: string; name: string | null; role: string | null; ageBand?: PersonAgeBand; skipped: boolean; momentCount: number; sampleShotIds: string[]; sampleFaces?: { shotId: string; uri: string; bbox: [number, number, number, number] }[]; days: number[]; similarPersonId?: string; similarity?: number }[] | null;
  peopleConfirmed: boolean;
  dismissedPersonSuggestionIds?: string[];
  plan: StoryPlan | null;
  momentsConfirmed: boolean;
  conflict: { shotIds: string[]; message: string } | null;
  direction: { aspect?: "9:16" | "16:9"; confirmed: boolean; pace: "gentle" | "lively"; lengthSec: number; focus: string; collageAmount?: "few" | "lots" | "none"; motionFeel?: "calm" | "playful" } | null;
  directionNote?: string;
  generation: { status: "queued" | "running" | "done" | "failed"; stage: "queued" | "composing" | "playable" | "rendering" | "saved" | "failed"; progress: number; stepsDone: number; film: Film | null } | null;
  notes: string[];
  filmWait?: { elapsedSec: number; videoCount: number };
  mergeEvents?: { id: string; personId: string; targetPersonId: string; answer: string; targetName: string; sampleFaces: string[]; questionFaces?: string[]; momentCount: number; automatic?: boolean; response?: "Yes, same person" | "No, another person" }[];
};

export type ChatItem =
  | { kind: "mosae"; id: string; text: string; facts?: string[]; photos?: string[] }
  | { kind: "you"; id: string; text: string }
  | { kind: "typing"; id: string; text: string; photoProgress?: NonNullable<ProjectSummary["assetStatuses"]> }
  | { kind: "preparing-videos"; id: string; text: string; progress: number }
  | { kind: "occasion"; id: string }
  | { kind: "person"; id: string; personId: string; ageBand?: PersonAgeBand; momentCount: number; sampleShotIds: string[]; sampleFaces: { shotId: string; uri: string; bbox: [number, number, number, number] }[]; days: number[]; questionText?: string }
  | { kind: "person-confirm"; id: string; personId: string; label: string; text: string; momentCount: number; sampleFaces: { shotId: string; uri: string; bbox: [number, number, number, number] }[] }
  | { kind: "merge-followup"; id: string; text: string; answer: string; photos: string[]; response?: "Yes, same person" | "No, another person" }
  | { kind: "anyone-else"; id: string }
  | { kind: "set-aside"; id: string; blurry: number; duplicates: number; blurryPhotos: { shotId: string; uri: string }[]; blurryMore: number; duplicatePhotos: { shotId: string; uri: string }[]; duplicateMore: number }
  | { kind: "moments"; id: string; suggestedShotIds: string[] }
  | { kind: "direction"; id: string; aspect: "9:16" | "16:9"; orientation?: NonNullable<ProjectSummary["orientation"]>; pace: string; lengthSec: number; focus: string; momentCount: number }
  | { kind: "shaping"; id: string; progress: number; stepsDone: number }
  | { kind: "film"; id: string; film: Film };

export type ChatState = {
  items: ChatItem[];
  step: "occasion" | "people" | "moments" | "direction" | "shaping" | "ready";
  confirmed: 0 | 1 | 2 | 3 | 4;
  placeholder: string;
};
