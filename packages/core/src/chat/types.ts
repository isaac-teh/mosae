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
  upload?: { expected: number; settled: number; failed: number; cancelled: number; closed: boolean };
  ready: { summary: boolean; faces: boolean; plan: boolean; story?: boolean };
  assetStatuses?: { assetId: string; kind: "photo" | "video"; status: "uploaded" | "ingested" | "understood" | "failed" }[];
};

export type ChatInput = {
  localMediaPending?: boolean;
  uploadFailuresAcknowledged?: boolean;
  summary: ProjectSummary | null;
  intent: { text: string } | null;
  people: { personId: string; name: string | null; role: string | null; ageBand?: PersonAgeBand; skipped: boolean; momentCount: number; sampleShotIds: string[]; sampleFaces?: { shotId: string; uri: string; bbox: [number, number, number, number] }[]; days: number[]; similarPersonId?: string; similarity?: number }[] | null;
  peopleConfirmed: boolean;
  plan: StoryPlan | null;
  momentsConfirmed: boolean;
  conflict: { shotIds: string[]; message: string } | null;
  direction: { confirmed: boolean; pace: "gentle" | "lively"; lengthSec: number; focus: string; collageAmount?: "few" | "lots" | "none"; motionFeel?: "calm" | "playful" } | null;
  directionNote?: string;
  generation: { status: "queued" | "running" | "done" | "failed"; stage: "queued" | "composing" | "playable" | "rendering" | "saved" | "failed"; progress: number; stepsDone: number; film: Film | null } | null;
  notes: string[];
  mergeEvents?: { id: string; personId: string; targetPersonId: string; answer: string; targetName: string; sampleFaces: string[]; questionFaces?: string[]; momentCount: number; automatic?: boolean; response?: "Yes, same person" | "No, another person" }[];
};

export type ChatItem =
  | { kind: "mosae"; id: string; text: string; facts?: string[]; photos?: string[] }
  | { kind: "you"; id: string; text: string }
  | { kind: "typing"; id: string; text: string; photoProgress?: NonNullable<ProjectSummary["assetStatuses"]> }
  | { kind: "occasion"; id: string }
  | { kind: "person"; id: string; personId: string; ageBand?: PersonAgeBand; momentCount: number; sampleShotIds: string[]; sampleFaces: { shotId: string; uri: string; bbox: [number, number, number, number] }[]; days: number[] }
  | { kind: "merge-followup"; id: string; text: string; answer: string; photos: string[]; response?: "Yes, same person" | "No, another person" }
  | { kind: "anyone-else"; id: string }
  | { kind: "set-aside"; id: string; blurry: number; duplicates: number; blurryPhotos: { shotId: string; uri: string }[]; blurryMore: number; duplicatePhotos: { shotId: string; uri: string }[]; duplicateMore: number }
  | { kind: "moments"; id: string; suggestedShotIds: string[] }
  | { kind: "direction"; id: string; pace: string; lengthSec: number; focus: string; momentCount: number }
  | { kind: "shaping"; id: string; progress: number; stepsDone: number }
  | { kind: "film"; id: string; film: Film };

export type ChatState = {
  items: ChatItem[];
  step: "occasion" | "people" | "moments" | "direction" | "shaping" | "ready";
  confirmed: 0 | 1 | 2 | 3 | 4;
  placeholder: string;
};
