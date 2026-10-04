import { ALLOWED_COMBOS, COLLAGE_EFFECTS, COLLAGE_LAYOUTS, COLLAGE_MOTIONS, EditOpSchema, applyEdits, type EditOp, type Timeline } from "@mosae/contracts";
import type { GenerateOptions } from "../gemini/client.js";
import { MODELS } from "../gemini/pricing.js";
import { DemoLimitReached } from "../gemini/errors.js";
import type { EditContext } from "./editContext.js";

export type InterpretEditRequest = { text: string; timeline: Timeline; groundedContext?: import("./loadEditContext.js").EditContext } & Partial<EditContext>;
export type InterpretEditModelResult = { kind?: "edit" | "clarify" | "unsupported"; reply?: string; ops: EditOp[] };
export type InterpretEditResult = { kind: "edit" | "clarify" | "unsupported"; reply: string; ops: EditOp[] };
const fallbackReply = "I couldn't turn that into an edit. Try the tools below, or say it another way.";

const operationProperties = {
  op: { type: "STRING", enum: ["swapShot", "trim", "setPhotoDuration", "setCollageDuration", "move", "remove", "add", "setCollageLayout", "setCollageMotion", "setCollageEffect", "replaceCollageSlot", "splitCollage", "setSoundtrack", "setMusicVolume"] },
  clipId: { type: "STRING" }, shotId: { type: "STRING" }, inSec: { type: "NUMBER" }, outSec: { type: "NUMBER" }, sec: { type: "NUMBER" }, toIndex: { type: "INTEGER" },
  kind: { type: "STRING", enum: ["photo", "video"] }, afterClipId: { type: "STRING", nullable: true }, durationSec: { type: "NUMBER" }, sourceInSec: { type: "NUMBER" }, sourceOutSec: { type: "NUMBER" }, sourceDurationSec: { type: "NUMBER" },
  layoutId: { type: "STRING", enum: COLLAGE_LAYOUTS.map((layout) => layout.id) },
  motionId: { type: "STRING", enum: COLLAGE_MOTIONS.map((motion) => motion.id) },
  effectId: { type: "STRING", enum: COLLAGE_EFFECTS.map((effect) => effect.id), nullable: true }, slotId: { type: "STRING" }, soundtrackId: { type: "STRING" }, audioClipId: { type: "STRING" }, gainDb: { type: "NUMBER" },
};
const responseSchema = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["edit", "clarify", "unsupported"] },
    reply: { type: "STRING" },
    ops: { type: "ARRAY", items: { type: "OBJECT", properties: operationProperties, required: ["op"], additionalProperties: false } },
  },
  required: ["kind", "ops"],
};

const formatTime = (sec: number) => {
  const whole = Math.floor(sec);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
};
function compactTimeline(timeline: Timeline) {
  return timeline.videoClips.map((clip) => {
    const clipId = "kind" in clip ? clip.clipId : clip.id;
    const chapter = [...timeline.chapters].reverse().find((item) => item.startSec <= clip.startSec)?.title ?? "";
    const caption = timeline.captions.find((item) => item.startSec < clip.startSec + clip.durationSec && item.endSec > clip.startSec)?.text ?? "";
    return { clipId, chapter, caption, kind: "kind" in clip ? "collage" : clip.source.kind, time: `${formatTime(clip.startSec)}–${formatTime(clip.startSec + clip.durationSec)}` };
  });
}

function validate(value: unknown): InterpretEditModelResult {
  if (!value || typeof value !== "object" || !Array.isArray((value as { ops?: unknown }).ops)) throw new Error("ops must be an array");
  const result = value as { kind?: unknown; reply?: unknown; ops: unknown[] };
  if (result.kind !== undefined && !["edit", "clarify", "unsupported"].includes(String(result.kind))) throw new Error("kind must be edit, clarify, or unsupported");
  if (result.reply !== undefined && typeof result.reply !== "string") throw new Error("reply must be a string");
  const ops = result.ops.map((op) => {
    const parsed = EditOpSchema.safeParse(op);
    if (!parsed.success) throw new Error("invalid edit operation");
    return parsed.data;
  });
  return { ...(typeof result.kind === "string" ? { kind: result.kind as InterpretEditModelResult["kind"] } : {}), ...(typeof result.reply === "string" ? { reply: result.reply } : {}), ops };
}

function hasAmbiguousPerson(text: string, people: NonNullable<NonNullable<InterpretEditRequest["groundedContext"]>["people"]>): boolean {
  const normalizedText = text.toLocaleLowerCase();
  return people.some((person) => person.name && normalizedText.includes(person.name.toLocaleLowerCase())
    && people.filter((candidate) => candidate.name?.toLocaleLowerCase() === person.name!.toLocaleLowerCase()).length > 1);
}

function violatesScope(op: EditOp, scope: InterpretEditRequest["scope"]): boolean {
  if (!scope || scope.kind === "film") return false;
  if (scope.kind === "clip") {
    if ("clipId" in op) return op.clipId !== scope.clipId;
    if (op.op === "add") return op.afterClipId !== scope.clipId;
    return false;
  }
  if (op.op === "replaceCollageSlot" || op.op === "setCollageCrop" || op.op === "removeCollageSlot") {
    return op.clipId !== scope.clipId || op.slotId !== scope.slotId;
  }
  if ("clipId" in op) return true;
  return op.op === "add" || op.op === "setMusicVolume";
}

export async function interpretEdit(req: InterpretEditRequest, deps: {
  generate: (options: GenerateOptions<InterpretEditModelResult>) => Promise<unknown>;
}): Promise<InterpretEditResult> {
  if (req.groundedContext && hasAmbiguousPerson(req.text, req.groundedContext.people)) {
    return { kind: "clarify", reply: "Which person did you mean?", ops: [] };
  }
  try {
    const result = validate(await deps.generate({
      model: MODELS.analyze,
      stage: "editor.interpret",
      thinking: "MINIMAL",
      maxSchemaRepairs: 0,
      contents: [{ text: `Translate the user's request into a small ordered list of allowed edit operations for this film. Return kind=edit with a complete supported batch, kind=clarify for an ambiguous reference, or kind=unsupported for unavailable capabilities. Never return partial operations. Do not invent ids; use only clip, shot, slot, soundtrack and audio ids in the supplied context. Preserve current collage sources unless changing them is necessary. Prefer the smallest number of operations and return no more than 20. Respect selected scope when resolving "this". For collage layouts and motions, keep the selected layout-motion pair in this allowed list: ${JSON.stringify(ALLOWED_COMBOS)}. Reply briefly and factually.\nAllowed operation schema: ${JSON.stringify(responseSchema)}\nClips: ${JSON.stringify(compactTimeline(req.timeline))}\nGrounded context (owned candidates, confirmed people, scope, story, soundtracks, prior conversation): ${JSON.stringify(req.groundedContext ?? {})}\nScope: ${JSON.stringify(req.scope ?? { kind: "film" })}\nRequest: ${req.text}` }],
      responseSchema,
      validate,
    }));
  const context = req.groundedContext;
  const candidates = context ? new Map(context.candidates.map((candidate) => [candidate.shotId, candidate])) : null;
  const invalidContextOp = result.ops.some((op) => {
    if (violatesScope(op, req.scope ?? context?.scope)) return true;
    if (op.op === "swapShot" || op.op === "add" || op.op === "replaceCollageSlot") {
      const candidate = candidates?.get(op.shotId);
      const target = op.op === "swapShot" ? req.timeline.videoClips.find(clip => ("kind" in clip ? clip.clipId : clip.id) === op.clipId) : undefined;
      const expectedKind = op.op === "swapShot" ? target && !(("kind" in target)) ? target.source.kind : undefined : op.kind;
      if (candidates !== null && (!candidate || (expectedKind !== undefined && candidate.kind !== expectedKind))) return true;
      if (op.op === "add" && op.kind === "video" && candidate && (candidate.sourceStartSec === null || candidate.sourceEndSec === null || op.sourceInSec === undefined || op.sourceOutSec === undefined || op.sourceInSec < candidate.sourceStartSec || op.sourceOutSec > candidate.sourceEndSec)) return true;
    }
    if (op.op === "setSoundtrack") return context !== undefined && !context.soundtracks.some((track) => track.id === op.soundtrackId);
    if (op.op === "replaceCollageSlot" && context?.scope.kind === "slot" && (op.clipId !== context.scope.clipId || op.slotId !== context.scope.slotId)) return true;
    return false;
  });
  if (result.kind === "clarify") return { kind: "clarify", reply: result.reply?.trim() || "Could you clarify what you mean?", ops: [] };
  if (result.kind === "unsupported") return { kind: "unsupported", reply: result.reply?.trim() || fallbackReply, ops: [] };
  if (result.ops.length > 20 || !result.ops.length || invalidContextOp || !applyEdits(req.timeline, result.ops).ok) return { kind: "unsupported", reply: fallbackReply, ops: [] };
    return { kind: "edit", reply: result.reply?.trim() || "Here are the edits I suggest.", ops: result.ops };
  } catch (error) {
    if (error instanceof DemoLimitReached) throw error;
    return { kind: "unsupported", reply: fallbackReply, ops: [] };
  }
}
