import type { Film, StoryPlan } from "../story/types.js";
import type { PersonAgeBand } from "./personChips.js";
import type { DirectorFlow, FaceSample } from "@mosae/contracts";

export type ProjectSummary = {
  flowRevision?: number;
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
  upload?: { expected: number; settled: number; uploaded?: number; failed: number; failedAssetIds?: string[]; failedEntries?: { assetId: string; sessionId: string }[]; pendingEntries?: { assetId: string; sessionId: string }[]; processingFailed?: number; cancelled: number; closed: boolean };
  ready: { summary: boolean; faces: boolean; plan: boolean; story?: boolean; film?: boolean };
  assetStatuses?: { assetId: string; kind: "photo" | "video"; status: "uploaded" | "ingested" | "understood" | "failed" }[];
  videoStatuses?: { assetId: string; status: "processing" | "ready" | "failed"; progress: number }[];
};

export type ChatInput = {
  flow?: DirectorFlow;
  localMediaPending?: boolean;
  localUpload?: { total: number; settled: number; failed: number; photos: number; clips: number };
  earlyOccasionAnswer?: string;
  earlyOccasionStoryText?: string;
  interpTurns?: { question: string; reply?: string; personId?: string; stage?: "missed" | "summary" | "post-confirmation" }[];
  summaryFollowups?: { question: string; reply?: string }[];
  interpReplying?: boolean;
  pendingResponse?: "occasion" | "person";
  uploadFailuresAcknowledged?: boolean;
  summary: ProjectSummary | null;
  intent: { text: string } | null;
  mentionedPeople?: string[];
  missedAnswer?: string;
  peopleSummaryAnswer?: string;
  peopleSummaryCount?: number;
  missedReply?: string;
  storySummary?: string;
  people: { personId: string; name: string | null; role: string | null; answerText?: string; ageBand?: PersonAgeBand; skipped: boolean; forceShow?: boolean; momentCount: number; sampleShotIds: string[]; shotIds?: string[]; sampleFaces?: { shotId: string; uri: string; bbox: [number, number, number, number] }[]; days: number[]; similarPersonId?: string; similarity?: number }[] | null;
  peopleConfirmed: boolean;
  missedPeople?: { personId: string; name: string; momentCount: number; sampleUri?: string; sampleUris?: string[]; sampleFace?: FaceSample; skipped?: boolean }[];
  missedPersonTagging?: { personId: string; name: string } | null;
  taggedPerson?: { personId: string; name: string; photos: string[] };
  peopleSummaryConfirmed?: boolean;
  missedPeopleConfirmed?: boolean;
  proceededPersonIds?: string[];
  dismissedPersonSuggestionIds?: string[];
  plan: StoryPlan | null;
  planFailed?: boolean;
  momentsConfirmed: boolean;
  conflict: { shotIds: string[]; message: string } | null;
  direction: { aspect?: "9:16" | "16:9"; confirmed: boolean; pace: "gentle" | "lively"; lengthSec: number; focus: string; collageAmount?: "few" | "lots" | "none"; motionFeel?: "calm" | "playful" } | null;
  directionNote?: string;
  generation: { status: "queued" | "running" | "done" | "failed"; stage: "queued" | "composing" | "playable" | "rendering" | "saved" | "failed"; progress: number; stepsDone: number; film: Film | null } | null;
  notes: string[];
  filmWait?: { elapsedSec: number; videoCount: number };
  lateVideoDismissals?: string[];
  mergeEvents?: { id: string; personId: string; targetPersonId: string; answer: string; targetName: string; sampleFaces: string[]; questionFaces?: string[]; faceSamples?: { shotId: string; uri: string; bbox: [number, number, number, number] }[]; momentCount: number; automatic?: boolean; reconciled?: boolean; response?: "Yes, same person" | "No, another person" }[];
};

export type ChatItem =
  | { kind: "upload-status"; id: string; photos: number; clips: number; uploadTotal: number; uploadDone: number; uploadFailed: number; understood: number; understoodTotal: number; uploadComplete: boolean; understandingActive: boolean; understoodComplete: boolean; facesApplicable: boolean; facesComplete: boolean }
  | { kind: "occasion-question"; id: string; uploadComplete: boolean }
  | { kind: "mosae"; id: string; text: string; facts?: string[]; photos?: string[]; faceSamples?: { shotId: string; uri: string; bbox: [number, number, number, number] }[] }
  | { kind: "you"; id: string; text: string }
  | { kind: "typing"; id: string; text: string }
  | { kind: "preparing-videos"; id: string; text: string; progress: number }
  | { kind: "person"; id: string; personId: string; ageBand?: PersonAgeBand; momentCount: number; sampleShotIds: string[]; sampleFaces: { shotId: string; uri: string; bbox: [number, number, number, number] }[]; days: number[]; questionText?: string; turns?: { question: string; reply?: string }[] }
  | { kind: "person-confirm"; id: string; personId: string; label: string; text: string; momentCount: number; sampleFaces: { shotId: string; uri: string; bbox: [number, number, number, number] }[] }
  | { kind: "person-tagged"; id: string; personId: string; name: string; pronoun: "her" | "him" | "them"; momentCount: number; canProceed?: boolean; sampleFace?: { shotId: string; uri: string; bbox: [number, number, number, number] } }
  | { kind: "merge-followup"; id: string; text: string; answer: string; photos: string[]; faceSamples?: { shotId: string; uri: string; bbox: [number, number, number, number] }[]; response?: "Yes, same person" | "No, another person" }
  | { kind: "anyone-else"; id: string; text?: string; canConfirm?: boolean }
  | { kind: "missed-person"; id: string; personId: string; name: string; momentCount: number; photos: string[]; skipped?: boolean }
  | { kind: "people-summary"; id: string; people: { personId: string; name: string; momentCount: number; sampleUri?: string; sampleFace?: { shotId: string; uri: string; bbox: [number, number, number, number] } }[]; canConfirm?: boolean }
  | { kind: "set-aside"; id: string; blurry: number; duplicates: number; blurryPhotos: { shotId: string; uri: string }[]; blurryMore: number; duplicatePhotos: { shotId: string; uri: string }[]; duplicateMore: number }
  | { kind: "moments"; id: string; suggestedShotIds: string[] }
  | { kind: "direction"; id: string; aspect: "9:16" | "16:9"; orientation?: NonNullable<ProjectSummary["orientation"]>; pace: string; lengthSec: number; focus: string; momentCount: number }
  | { kind: "shaping"; id: string; progress: number; stepsDone: number }
  | { kind: "late-video"; id: string; assetId: string; text: string; status: "added" | "offered" }
  | { kind: "film"; id: string; film: Film };

export type ChatState = {
  /** The canonical chronological event stream rendered by the chat. */
  items: ChatItem[];
  step: "occasion" | "people" | "moments" | "direction" | "shaping" | "ready";
  confirmed: 0 | 1 | 2 | 3 | 4;
  placeholder: string;
};
