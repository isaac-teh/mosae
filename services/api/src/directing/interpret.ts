import type { GenerateOptions } from "../gemini/client.js";
import { MODELS } from "../gemini/pricing.js";
import type { ProjectSummary } from "./summary.js";

export type ChatStep = "occasion" | "people" | "moments" | "direction";
export type InterpretRequest = {
  step: ChatStep;
  text: string;
  context: { summary?: ProjectSummary; people?: { personId: string; name: string | null; role: string | null }[] };
};
export type ChatChange =
  | { kind: "occasion"; storyText: string }
  | { kind: "person"; personId: string | null; name: string; role: "parent" | "child" | "other" }
  | { kind: "moments"; mustIncludeShotIds: string[] }
  | { kind: "direction"; pace?: "gentle" | "lively"; lengthSec?: 60 | 120 | 240; focus?: "family" | string }
  | { kind: "note"; note: string }
  | { kind: "unclear" };
export type InterpretResult = { reply: string; change: ChatChange };
export type InterpretModelChange = Exclude<ChatChange, { kind: "moments" }> | { kind: "moments"; query: string };
type ModelResult = { change: InterpretModelChange; confidence?: number; reply?: string };

const fallback = "I didn't catch that. Pick one below, or say it another way.";
const responseSchema = {
  type: "OBJECT",
  properties: {
    confidence: { type: "NUMBER" },
    reply: { type: "STRING" },
    change: { type: "OBJECT", properties: {
      kind: { type: "STRING", enum: ["occasion", "person", "moments", "direction", "note", "unclear"] },
      storyText: { type: "STRING" }, personId: { type: "STRING", nullable: true }, name: { type: "STRING" },
      role: { type: "STRING", enum: ["parent", "child", "other"] }, query: { type: "STRING" },
      pace: { type: "STRING", enum: ["gentle", "lively"] }, lengthSec: { type: "INTEGER", enum: [60, 120, 240] },
      focus: { type: "STRING" }, note: { type: "STRING" },
    }, required: ["kind"] },
  }, required: ["change"],
};

function validate(value: unknown): ModelResult {
  const result = value as ModelResult;
  if (!result || !result.change || typeof result.change.kind !== "string") throw new Error("invalid interpret result");
  const change = result.change as Record<string, unknown>;
  if (!["occasion", "person", "moments", "direction", "note", "unclear"].includes(String(change.kind))) throw new Error("invalid change kind");
  if (result.confidence !== undefined && (typeof result.confidence !== "number" || result.confidence < 0 || result.confidence > 1)) throw new Error("invalid confidence");
  if (change.kind === "moments" && typeof change.query !== "string") throw new Error("moments query is required");
  if (change.kind === "occasion" && typeof change.storyText !== "string") throw new Error("storyText is required");
  if (change.kind === "person" && (typeof change.name !== "string" || !["parent", "child", "other"].includes(String(change.role)))) throw new Error("invalid person change");
  if (change.kind === "direction" && (change.pace !== undefined && !["gentle", "lively"].includes(String(change.pace)) || change.lengthSec !== undefined && ![60, 120, 240].includes(Number(change.lengthSec)))) throw new Error("invalid direction change");
  if (change.kind === "note" && typeof change.note !== "string") throw new Error("note is required");
  return result;
}

export async function interpret(req: InterpretRequest, deps: {
  generate: (options: GenerateOptions<unknown>) => Promise<unknown>;
  searchShots: (query: string) => Promise<string[]>;
}): Promise<InterpretResult> {
  try {
    const modelResult = validate(await deps.generate({
      model: MODELS.analyze, stage: "chat.interpret", thinking: "MINIMAL",
      contents: [{ text: `Interpret the user's typed message only for the current director chat step. Nothing has been applied yet. Restate the proposed change as a concise confirmation question for the user, such as "Make it lively and about a minute?" If unrelated to this step, return kind note. If unsure, return unclear. For moments, return a concise semantic search query.\nStep: ${req.step}\nContext: ${JSON.stringify(req.context)}\nText: ${req.text}` }],
      responseSchema, validate,
    }));
    const allowedKind: Record<ChatStep, ChatChange["kind"]> = {
      occasion: "occasion", people: "person", moments: "moments", direction: "direction",
    };
    const returnedKind = modelResult.change.kind;
    if (returnedKind !== "note" && returnedKind !== allowedKind[req.step]) {
      return { reply: "I'll keep that in mind.", change: { kind: "note", note: req.text } };
    }
    if ((modelResult.confidence ?? 1) < 0.5 || modelResult.change.kind === "unclear") return { reply: fallback, change: { kind: "unclear" } };
    let change: ChatChange;
    if (modelResult.change.kind === "moments") {
      const ids = await deps.searchShots(modelResult.change.query);
      change = { kind: "moments", mustIncludeShotIds: ids.slice(0, 5) };
    } else change = modelResult.change;
    const reply = modelResult.reply?.trim() || `I understood: ${change.kind === "note" ? change.note : req.text.trim()}`;
    return { reply, change };
  } catch {
    return { reply: fallback, change: { kind: "unclear" } };
  }
}
