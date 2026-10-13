import type { GenerateOptions } from "../gemini/client.js";
import { MODELS } from "../gemini/pricing.js";
import { DemoLimitReached } from "../gemini/errors.js";
import type { ProjectSummary } from "./summary.js";

export type ChatStep = "occasion" | "people" | "moments" | "direction";
export type InterpretRequest = {
  step: ChatStep;
  text: string;
  context: { summary?: ProjectSummary; people?: { personId: string; name: string | null; role: string | null }[]; peopleStage?: "identify" | "tagged" | "missed" | "summary" };
};
export type PeopleIntent = "assign" | "skip" | "proceed" | "missed" | "confirm" | "change" | "unclear";
export type ChatChange =
  | { kind: "occasion"; storyText: string; mentionedPeople?: string[] }
  | { kind: "person"; personId: string | null; name: string; role: "parent" | "child" | "other"; intent: PeopleIntent; names: string[]; needsClarification: boolean; clarifyingQuestion?: string }
  | { kind: "moments"; mustIncludeShotIds: string[] }
  | { kind: "direction"; pace?: "gentle" | "lively"; lengthSec?: 60 | 120 | 240; focus?: "family" | string }
  | { kind: "note"; note: string }
  | { kind: "unclear" };
export type InterpretResult = { reply: string; change: ChatChange };
export type InterpretModelChange = Exclude<ChatChange, { kind: "moments" }> | { kind: "moments"; query: string };
type ModelResult = { change: InterpretModelChange; confidence?: number; reply?: string };

const fallback = "I didn't catch that. Pick one below, or say it another way.";
const baseResponseSchema = {
  type: "OBJECT",
  properties: {
    confidence: { type: "NUMBER" },
    reply: { type: "STRING" },
    change: { type: "OBJECT", properties: {
      kind: { type: "STRING", enum: ["occasion", "person", "moments", "direction", "note", "unclear"] },
      storyText: { type: "STRING" }, personId: { type: "STRING", nullable: true }, name: { type: "STRING" },
      mentionedPeople: { type: "ARRAY", items: { type: "STRING" } },
      role: { type: "STRING", enum: ["parent", "child", "other"] }, query: { type: "STRING" },
      pace: { type: "STRING", enum: ["gentle", "lively"] }, lengthSec: { type: "INTEGER", enum: [60, 120, 240] },
      focus: { type: "STRING" }, note: { type: "STRING" },
    }, required: ["kind"] },
  }, required: ["change"],
};
const responseSchema = {
  ...baseResponseSchema,
  properties: {
    ...baseResponseSchema.properties,
    change: { ...baseResponseSchema.properties.change, required: ["kind", "intent", "names", "needsClarification", "role", "name"], properties: {
      ...baseResponseSchema.properties.change.properties,
      intent: { type: "STRING", enum: ["assign", "skip", "proceed", "missed", "confirm", "change", "unclear"] },
      names: { type: "ARRAY", items: { type: "STRING" } },
      needsClarification: { type: "BOOLEAN" },
      clarifyingQuestion: { type: "STRING" },
    } },
  },
};

function validate(value: unknown): ModelResult {
  const result = value as ModelResult;
  if (!result || !result.change || typeof result.change.kind !== "string") throw new Error("invalid interpret result");
  const change = result.change as Record<string, unknown>;
  if (!["occasion", "person", "moments", "direction", "note", "unclear"].includes(String(change.kind))) throw new Error("invalid change kind");
  if (result.confidence !== undefined && (typeof result.confidence !== "number" || result.confidence < 0 || result.confidence > 1)) throw new Error("invalid confidence");
  if (change.kind === "moments" && typeof change.query !== "string") throw new Error("moments query is required");
  if (change.kind === "occasion" && typeof change.storyText !== "string") throw new Error("storyText is required");
  if (change.kind === "occasion" && change.mentionedPeople !== undefined && (!Array.isArray(change.mentionedPeople) || change.mentionedPeople.some((person) => typeof person !== "string"))) throw new Error("mentionedPeople must be strings");
  if (change.kind === "person" && change.needsClarification === true && typeof change.clarifyingQuestion !== "string") throw new Error("clarifyingQuestion is required");
  if (change.kind === "person" && change.names !== undefined && (!Array.isArray(change.names) || change.names.some((name) => typeof name !== "string"))) throw new Error("invalid people names");
  if (change.kind === "direction" && (change.pace !== undefined && !["gentle", "lively"].includes(String(change.pace)) || change.lengthSec !== undefined && ![60, 120, 240].includes(Number(change.lengthSec)))) throw new Error("invalid direction change");
  if (change.kind === "note" && typeof change.note !== "string") throw new Error("note is required");
  return result;
}

export async function interpret(req: InterpretRequest, deps: {
  generate: (options: GenerateOptions<unknown>) => Promise<unknown>;
  searchShots: (query: string) => Promise<string[]>;
}): Promise<InterpretResult> {
  if (req.step === "people") {
    const exact = req.text.trim().replace(/[.!?]+$/, "").toLocaleLowerCase();
    const stage = req.context.peopleStage ?? "identify";
    const fast = (intent: PeopleIntent): InterpretResult => ({ reply: "", change: { kind: "person", personId: null, name: "", role: "other", intent, names: [], needsClarification: false } });
    if (/^(proceed|next|continue|looks good|ok|okay)$/.test(exact) && stage === "tagged") return fast("proceed");
    if (/^(that's everyone|that’s everyone|that's all|that’s all)$/.test(exact) || stage === "missed" && /^(no|no one else|nobody else|none)$/.test(exact)) return fast("confirm");
    if (/^(ok|okay|good|yes|yeah|yep|looks right|continue)$/.test(exact) && stage === "summary") return fast("confirm");
    if (/^(skip|don't know|dont know|not sure|i don't know|i’m not sure|i'm not sure)$/.test(exact) && stage === "identify") return fast("skip");
  }
  try {
    const modelResult = validate(await deps.generate({
      model: MODELS.analyze, stage: "chat.interpret", thinking: "MINIMAL",
      contents: [{ text: req.step === "people"
        ? `Interpret the user's typed message only for the current director chat step. Nothing has been applied yet. For people, return a typed intent of assign, skip, proceed, missed, confirm, change or unclear; names as a list, role, needsClarification and a short clarifyingQuestion when needed. Identify one person from relationship words and normalize role as parent, child or other; vague plurals such as "my two cousins" must ask for names. Return multiple missed names separately. Detect correction/addition requests as change and confirmations as confirm. If unrelated to this step, return kind note.\nStep: ${req.step}\nContext: ${JSON.stringify(req.context)}\nText: ${req.text}`
        : `Interpret the user's typed message only for the current director chat step. Nothing has been applied yet. Restate the proposed change as a concise confirmation question for the user, such as "Make it lively and about a minute?" For occasion, return normalized storyText and mentionedPeople containing only people explicitly named by the user (relationships such as their son or a person's name); omit it when none are mentioned. If unrelated to this step, return kind note. If unsure, return unclear. For moments, return a concise semantic search query.\nStep: ${req.step}\nContext: ${JSON.stringify(req.context)}\nText: ${req.text}` }],
      responseSchema: req.step === "people" ? responseSchema : baseResponseSchema, validate,
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
    if (change.kind === "person") {
      const personChange = modelResult.change as Record<string, unknown>;
      const names = Array.isArray(personChange.names) ? personChange.names as string[] : typeof personChange.name === "string" && personChange.name ? [personChange.name] : [];
      const intent = (personChange.intent as PeopleIntent | undefined) ?? "assign";
      const needsClarification = personChange.needsClarification === true;
      if (needsClarification && typeof personChange.clarifyingQuestion !== "string") throw new Error("clarifyingQuestion is required");
      change = { kind: "person", personId: typeof personChange.personId === "string" ? personChange.personId : null, name: typeof personChange.name === "string" ? personChange.name : names[0] ?? "", role: ["parent", "child", "other"].includes(String(personChange.role)) ? personChange.role as "parent" | "child" | "other" : "other", intent, names, needsClarification, ...(typeof personChange.clarifyingQuestion === "string" ? { clarifyingQuestion: personChange.clarifyingQuestion } : {}) };
    }
    const reply = modelResult.reply?.trim() || `I understood: ${change.kind === "note" ? change.note : req.text.trim()}`;
    return { reply, change };
  } catch (error) {
    if (error instanceof DemoLimitReached) throw error;
    return { reply: fallback, change: { kind: "unclear" } };
  }
}
