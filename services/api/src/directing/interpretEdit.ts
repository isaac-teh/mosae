import { ALLOWED_COMBOS, COLLAGE_EFFECTS, COLLAGE_LAYOUTS, COLLAGE_MOTIONS, EditOpSchema, applyEdits, type EditOp, type Timeline } from "@mosae/contracts";
import type { GenerateOptions } from "../gemini/client.js";
import { MODELS } from "../gemini/pricing.js";
import { DemoLimitReached } from "../gemini/errors.js";
import type { EditContext } from "./editContext.js";

export type InterpretEditRequest = { text: string; timeline: Timeline; groundedContext?: import("./loadEditContext.js").EditContext } & Partial<EditContext>;
export type InterpretEditModelResult = { kind?: "edit" | "clarify" | "unsupported"; reply?: string; ops: EditOp[] };
export type InterpretEditResult = { kind: "edit" | "clarify" | "unsupported"; reply: string; ops: EditOp[] };
const fallbackReply = "I couldn't turn that into an edit. Try the tools below, or say it another way.";

type ModelSchema = Record<string, any>;

function zodModelSchema(schema: any): ModelSchema {
  const def = schema.def ?? schema._def;
  switch (def.type) {
    case "optional": return zodModelSchema(def.innerType);
    case "nullable": return { ...zodModelSchema(def.innerType), nullable: true };
    case "literal": {
      const values = [...def.values];
      const value = values[0];
      if (typeof value === "boolean") return { type: "BOOLEAN" };
      if (value === null) return { type: "NULL" };
      return { type: typeof value === "number" ? "NUMBER" : "STRING", enum: values.map(String) };
    }
    case "enum": return { type: "STRING", enum: Object.values(def.entries) };
    case "string": return { type: "STRING" };
    case "number": return { type: schema.isInt ? "INTEGER" : "NUMBER" };
    case "array": return { type: "ARRAY", items: zodModelSchema(def.element) };
    case "object": return zodObjectSchema(schema);
    case "union": return { anyOf: def.options.map(zodModelSchema) };
    default: throw new Error(`Unsupported EditOpSchema field type: ${String(def.type)}`);
  }
}

function zodObjectSchema(schema: any): ModelSchema {
  const shape = schema.shape;
  const properties = Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, zodModelSchema(value)]));
  const required = Object.entries(shape).filter(([, value]: [string, any]) => value.def?.type !== "optional").map(([key]) => key);
  return { type: "OBJECT", properties, ...(required.length ? { required } : {}) };
}

const editOpVariants = (EditOpSchema as any).options as any[];

function responseSchemaFor(req: InterpretEditRequest) {
  const clipIds = req.timeline.videoClips.map((clip) => "kind" in clip ? clip.clipId : clip.id);
  const ownedCandidates = req.groundedContext?.candidates ?? [];
  const usedShotIds = new Set(req.timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.flatMap((slot) => slot.shotId ? [slot.shotId] : []) : [clip.source.shotId]));
  const slotIds = req.timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.map((slot) => slot.slotId) : []);
  const soundtrackIds = req.groundedContext?.soundtracks.map((track) => track.id) ?? [];
  const audioIds = [...req.timeline.audioClips.map((clip) => clip.id), "editor-soundtrack"];
  const items = editOpVariants.map((variant) => {
    const op = variant.shape.op.values.values().next().value as string;
    const schema = zodObjectSchema(variant);
    const properties = schema.properties as Record<string, ModelSchema>;
    if (properties.clipId) properties.clipId.enum = clipIds;
    if (properties.shotId) {
      const allowed = op === "add" || op === "addCollageSlot"
        ? ownedCandidates.filter((candidate) => !usedShotIds.has(candidate.shotId))
        : ownedCandidates;
      const ids = [...new Set(allowed.map((candidate) => candidate.shotId))];
      if (ids.length) properties.shotId.enum = ids;
    }
    if (properties.slotId) {
      if (op === "addCollageSlot") properties.slotId.enum = ["new-slot"];
      else if (slotIds.length) properties.slotId.enum = slotIds;
    }
    if (properties.soundtrackId && soundtrackIds.length) properties.soundtrackId.enum = soundtrackIds;
    if (properties.audioClipId && audioIds.length) properties.audioClipId.enum = audioIds;
    if (properties.layoutId) properties.layoutId.enum = COLLAGE_LAYOUTS.map((layout) => layout.id);
    if (properties.motionId) properties.motionId.enum = COLLAGE_MOTIONS.map((motion) => motion.id);
    if (properties.effectId) properties.effectId.enum = COLLAGE_EFFECTS.map((effect) => effect.id);
    return schema;
  });
  return {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["edit", "clarify", "unsupported"] },
    reply: { type: "STRING" },
    ops: { type: "ARRAY", items: { anyOf: items } },
  },
  required: ["kind", "ops"],
  };
}

class InvalidEditReply extends Error {
  constructor(readonly kind: "clarify" | "unsupported", readonly reply: string) { super(reply); }
}

function normalizeAliases(op: unknown): unknown {
  if (!op || typeof op !== "object" || Array.isArray(op)) return op;
  const source = op as Record<string, unknown>;
  if (source.op === "addCollageSlot") return { ...source, slotId: "new-slot" };
  if ((source.op === "setPhotoDuration" || source.op === "setCollageDuration") && source.sec === undefined && typeof source.durationSec === "number") {
    const { durationSec, ...rest } = source;
    console.warn(`Normalized Gemini edit alias durationSec -> sec for ${source.op}`);
    return { ...rest, sec: durationSec };
  }
  return op;
}

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
  const ops = result.ops.map((rawOp) => {
    const op = normalizeAliases(rawOp);
    const parsed = EditOpSchema.safeParse(op);
    if (!parsed.success) {
      const candidate = op as Record<string, unknown> | null;
      if (candidate?.op === "add" && !candidate.shotId) throw new InvalidEditReply("clarify", "Which photo should I add? I need a photo from this project to make that edit.");
      const opName = typeof candidate?.op === "string" ? candidate.op : "edit";
      throw new InvalidEditReply("clarify", `I couldn't apply the ${opName} edit because a required detail is missing or invalid. Please specify the photo, clip, or value to change.`);
    }
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
    const filmWide = isWholeFilmRequest(req.text) && req.scope?.kind !== "film";
    const scope = filmWide ? { kind: "film" as const } : req.scope;
    const request = { ...req, scope };
    const responseSchema = responseSchemaFor(request);
    const result = validate(await deps.generate({
      model: MODELS.analyze,
      stage: "editor.interpret",
      thinking: "MINIMAL",
      maxSchemaRepairs: 0,
      contents: [{ text: `Translate the user's request into a small ordered list of allowed edit operations for this film. Return kind=edit with a complete supported batch, kind=clarify for an ambiguous reference, or kind=unsupported for unavailable capabilities. Never return partial operations. Do not invent clip, shot, slot, soundtrack or audio ids; use only the enumerated ids in the supplied context. For addCollageSlot, use the literal slotId "new-slot"; the editor assigns its internal slot id. Preserve current collage sources unless changing them is necessary. For "add more collage", use addCollageSlot with an unused owned photo candidate when one is available; otherwise ask which photos to include. Never invent a shotId. Prefer the smallest number of operations and return no more than 20. Respect selected scope when resolving "this". An explicit request for all clips or the whole film can affect clips outside the selected clip. For collage layouts and motions, keep the selected layout-motion pair in this allowed list: ${JSON.stringify(ALLOWED_COMBOS)}. Reply briefly and factually.\nAllowed operation schema: ${JSON.stringify(responseSchema)}\nClips: ${JSON.stringify(compactTimeline(req.timeline))}\nGrounded context (owned candidates, confirmed people, scope, story, soundtracks, prior conversation): ${JSON.stringify({ ...req.groundedContext, scope: request.scope ?? req.groundedContext?.scope })}\nScope: ${JSON.stringify(request.scope ?? { kind: "film" })}\nRequest: ${req.text}` }],
      responseSchema,
      validate,
    }));
    const context = req.groundedContext;
    const candidates = context ? new Map(context.candidates.map((candidate) => [candidate.shotId, candidate])) : null;
    const resolvedSlotIds = new Set<string>();
    const ops = result.ops.map((op) => {
      if (op.op === "addCollageSlot") {
        const existing = new Set(req.timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.map((slot) => slot.slotId) : []));
        let slotId = `ai-slot-${op.clipId}-1`;
        let suffix = 1;
        while (existing.has(slotId) || resolvedSlotIds.has(slotId)) slotId = `ai-slot-${op.clipId}-${++suffix}`;
        resolvedSlotIds.add(slotId);
        return { ...op, slotId };
      }
      if (op.op !== "swapShot") return op;
      const candidate = candidates?.get(op.shotId);
      const { sourceStartSec: _modelStart, sourceEndSec: _modelEnd, ...trustedBase } = op;
      return candidate?.kind === "video" && candidate.sourceEndSec !== null
        ? { ...trustedBase, sourceStartSec: candidate.sourceStartSec ?? 0, sourceEndSec: candidate.sourceEndSec }
        : trustedBase;
    });
    const invalidContextOp = ops.some((op) => {
      if (violatesScope(op, scope ?? context?.scope)) return true;
      if (op.op === "swapShot" || op.op === "add" || op.op === "addCollageSlot" || op.op === "replaceCollageSlot") {
        const candidate = candidates?.get(op.shotId);
        const target = op.op === "swapShot" ? req.timeline.videoClips.find(clip => ("kind" in clip ? clip.clipId : clip.id) === op.clipId) : undefined;
        const expectedKind = op.op === "swapShot" ? target && !("kind" in target) ? target.source.kind : undefined : op.kind;
        if (!candidates || !candidate || (expectedKind !== undefined && candidate.kind !== expectedKind)) return true;
        if (op.op === "addCollageSlot" && usedShotIdsForTimeline(req.timeline).has(op.shotId)) return true;
        if (op.op === "swapShot" && target && !("kind" in target) && target.source.kind === "video" && candidate) {
          const from = target.source.sourceInSec ?? 0;
          const to = target.source.sourceOutSec ?? target.source.sourceDurationSec ?? target.durationSec;
          if (candidate.sourceStartSec === null || candidate.sourceEndSec === null || from < candidate.sourceStartSec || to > candidate.sourceEndSec) return true;
        }
        if (op.op === "add" && op.kind === "video" && candidate && (candidate.sourceStartSec === null || candidate.sourceEndSec === null || op.sourceInSec === undefined || op.sourceOutSec === undefined || op.sourceInSec < candidate.sourceStartSec || op.sourceOutSec > candidate.sourceEndSec)) return true;
      }
      if (op.op === "setSoundtrack") return context !== undefined && !context.soundtracks.some((track) => track.id === op.soundtrackId);
      if (op.op === "replaceCollageSlot" && context?.scope.kind === "slot" && (op.clipId !== context.scope.clipId || op.slotId !== context.scope.slotId)) return true;
      return false;
    });
    if (result.kind === "clarify") return { kind: "clarify", reply: result.reply?.trim() || "Could you clarify what you mean?", ops: [] };
    if (result.kind === "unsupported") return { kind: "unsupported", reply: result.reply?.trim() || fallbackReply, ops: [] };
    if (ops.length > 20 || !ops.length) return { kind: "unsupported", reply: fallbackReply, ops: [] };
    if (invalidContextOp && ops.some((op) => op.op === "addCollageSlot")) return { kind: "clarify", reply: "Which unused photos from this project should I add to the collage?", ops: [] };
    if (invalidContextOp) return { kind: "unsupported", reply: "I couldn't apply that because it refers to a clip or source outside the available project context.", ops: [] };
    const applied = applyEdits(req.timeline, ops);
    if (!applied.ok) return { kind: "unsupported", reply: `I couldn't apply that edit: ${applied.error}.`, ops: [] };
    return { kind: "edit", reply: result.reply?.trim() || "Here are the edits I suggest.", ops };
  } catch (error) {
    if (error instanceof DemoLimitReached) throw error;
    if (error instanceof InvalidEditReply) return { kind: error.kind, reply: error.reply, ops: [] };
    console.error("edit interpretation failed", error instanceof Error ? error.message : String(error));
    return { kind: "unsupported", reply: fallbackReply, ops: [] };
  }
}

export function isWholeFilmRequest(text: string): boolean {
  return /\b(all|every|entire|whole)\b.{0,40}\b(clips?|film|video|timeline|photos?|collages?)\b|\b(clips?|film|video|timeline|photos?|collages?)\b.{0,40}\b(all|every|entire|whole)\b|\bfor\s+all\b/i.test(text);
}

function usedShotIdsForTimeline(timeline: Timeline): Set<string> {
  return new Set(timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.flatMap((slot) => slot.shotId ? [slot.shotId] : []) : [clip.source.shotId]));
}
