import type { Film, StoryPlan } from "../story/types.js";

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
  ready: { summary: boolean; faces: boolean; plan: boolean };
};

export type ChatInput = {
  summary: ProjectSummary | null;
  intent: { text: string } | null;
  people: { personId: string; name: string | null; role: string | null; skipped: boolean; momentCount: number; sampleShotIds: string[]; sampleFaces?: { shotId: string; uri: string; bbox: [number, number, number, number] }[]; days: number[] }[] | null;
  peopleConfirmed: boolean;
  plan: StoryPlan | null;
  momentsConfirmed: boolean;
  conflict: { shotIds: string[]; message: string } | null;
  direction: { confirmed: boolean; pace: "gentle" | "lively"; lengthSec: number; focus: string } | null;
  generation: { status: "queued" | "running" | "done" | "failed"; stepsDone: number; film: Film | null } | null;
  notes: string[];
};

export type ChatItem =
  | { kind: "mosae"; id: string; text: string; facts?: string[]; photos?: string[] }
  | { kind: "you"; id: string; text: string }
  | { kind: "typing"; id: string; text: string }
  | { kind: "occasion"; id: string }
  | { kind: "person"; id: string; personId: string; momentCount: number; sampleShotIds: string[]; sampleFaces: { shotId: string; uri: string; bbox: [number, number, number, number] }[]; days: number[] }
  | { kind: "anyone-else"; id: string }
  | { kind: "set-aside"; id: string; blurry: number; duplicates: number }
  | { kind: "moments"; id: string; suggestedShotIds: string[] }
  | { kind: "direction"; id: string; pace: string; lengthSec: number; focus: string; momentCount: number }
  | { kind: "shaping"; id: string; stepsDone: number }
  | { kind: "film"; id: string; film: Film };

export type ChatState = {
  items: ChatItem[];
  step: "occasion" | "people" | "moments" | "direction" | "shaping" | "ready";
  confirmed: 0 | 1 | 2 | 3 | 4;
  placeholder: string;
};
