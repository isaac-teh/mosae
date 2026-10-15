import { ALLOWED_COMBOS, COLLAGE_EFFECTS, COLLAGE_LAYOUTS, COLLAGE_MOTIONS, EditOpSchema, applyEdits, assignCollageSlots, collageSlotAspects, type EditOp, type Timeline } from "@mosae/contracts";
import type { GenerateOptions } from "../gemini/client.js";
import { MODELS } from "../gemini/pricing.js";
import { DemoLimitReached } from "../gemini/errors.js";
import type { EditContext } from "./editContext.js";

export type InterpretEditRequest = { text: string; timeline: Timeline; groundedContext?: import("./loadEditContext.js").EditContext } & Partial<EditContext>;
export type InterpretEditModelResult = { kind?: "edit" | "clarify" | "unsupported"; reply?: string; ops: EditOp[] };
export type InterpretEditResult = { kind: "edit" | "clarify" | "unsupported"; reply: string; ops: EditOp[] };
const fallbackReply = "I can reorder or trim moments, swap photos, change framing or collage layout, and adjust the soundtrack. What would you like to change?";
const unavailableFeatureReply = "I can reorder moments, retime photos or collages, change framing or collage layout, swap photos, or adjust music. Which would you like?";

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

function responseSchemaFor() {
  const items = editOpVariants.map((variant) => {
    const op = variant.shape.op.values.values().next().value as string;
    const schema = zodObjectSchema(variant);
    const properties = schema.properties as Record<string, ModelSchema>;
    if (properties.slotId && op === "addCollageSlot") properties.slotId.enum = ["new-slot"];
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

function allowedIdsFor(req: InterpretEditRequest) {
  const usedShotIds = new Set(usedShotIdsForTimeline(req.timeline));
  const candidates = req.groundedContext?.candidates ?? [];
  const clipIds = req.timeline.videoClips.map((clip) => "kind" in clip ? clip.clipId : clip.id);
  const shotIds = [...new Set([...usedShotIds, ...candidates.map((candidate) => candidate.shotId)])];
  const unusedShotIds = [...new Set(candidates.filter((candidate) => !usedShotIds.has(candidate.shotId)).map((candidate) => candidate.shotId))];
  const slotIds = [...new Set(req.timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.map((slot) => slot.slotId) : []))];
  const audioClipIds = [...new Set([...req.timeline.audioClips.map((clip) => clip.id), "editor-soundtrack"])];
  const soundtrackIds = [...new Set((req.groundedContext?.soundtracks ?? []).map((track) => track.id))];
  return { clipIds, shotIds, unusedShotIds, slotIds, audioClipIds, soundtrackIds };
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
    const chapter = [...timeline.chapters].reverse().find((item) => item.startSec <= clip.startSec)?.title ?? "";
    const caption = timeline.captions.find((item) => item.startSec < clip.startSec + clip.durationSec && item.endSec > clip.startSec)?.text ?? "";
    return { chapter, caption, kind: "kind" in clip ? "collage" : clip.source.kind, time: `${formatTime(clip.startSec)}–${formatTime(clip.startSec + clip.durationSec)}` };
  });
}

function promptContext(req: InterpretEditRequest) {
  const context = req.groundedContext;
  if (!context) return undefined;
  return {
    storyIntent: context.storyIntent,
    constraints: context.constraints,
    people: context.people,
    selected: context.selected ? { captions: context.selected.captions } : null,
    candidates: context.candidates.map(({ shotId: _shotId, ...candidate }) => candidate),
    soundtracks: context.soundtracks.map(({ id: _id, storagePath: _storagePath, ...track }) => track),
    conversation: context.conversation,
  };
}

function opsReferenceClarification(ops: EditOp[], allowed: ReturnType<typeof allowedIdsFor>): string | null {
  for (const op of ops) {
    if ("clipId" in op && !allowed.clipIds.includes(op.clipId)) return `I couldn't find clip “${op.clipId}” in this film. Which clip did you mean?`;
    if (op.op === "add" && op.afterClipId !== null && !allowed.clipIds.includes(op.afterClipId)) return `I couldn't find clip “${op.afterClipId}” to add after. Which clip did you mean?`;
    if ("slotId" in op && op.op !== "addCollageSlot" && !allowed.slotIds.includes(op.slotId)) return `I couldn't find collage slot “${op.slotId}”. Which photo in the collage did you mean?`;
    const checkShot = (shotId: string | null | undefined) => shotId && !allowed.shotIds.includes(shotId) ? `I couldn't find photo or video “${shotId}” in this project. Which one should I use?` : null;
    if ("shotId" in op) {
      const invalidShot = checkShot(op.shotId);
      if (invalidShot) return invalidShot;
    }
    if (op.op === "setCollageSpec") {
      for (const slot of op.spec.slots) {
        const invalidShot = checkShot(slot.shotId);
        if (invalidShot) return invalidShot;
        if (!allowed.slotIds.includes(slot.slotId)) return `I couldn't find collage slot “${slot.slotId}”. Which existing collage photo should I keep or change?`;
      }
    }
    if (op.op === "setSoundtrack" && !allowed.soundtrackIds.includes(op.soundtrackId)) return `I couldn't find soundtrack “${op.soundtrackId}” in the available music. Which soundtrack did you mean?`;
    if (op.op === "setMusicVolume" && !allowed.audioClipIds.includes(op.audioClipId)) return `I couldn't find audio clip “${op.audioClipId}” in this film. Which music or audio track did you mean?`;
  }
  return null;
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

function mentionsPerson(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

function hasAmbiguousPerson(text: string, people: NonNullable<NonNullable<InterpretEditRequest["groundedContext"]>["people"]>): boolean {
  return people.some((person) => person.name && mentionsPerson(text, person.name)
    && people.filter((candidate) => candidate.name?.toLocaleLowerCase() === person.name!.toLocaleLowerCase()).length > 1);
}

/** Resolve chat-form focus choices against confirmed people and owned media.
 * An existing film cannot change its generator settings, so focus edits promote
 * moments containing the requested people through the normal timeline move op.
 */
function focusEdit(req: InterpretEditRequest): InterpretEditResult | null {
  const context = req.groundedContext;
  if (!context || !/\b(?:focus|feature|emphasize)\b/i.test(req.text)) return null;
  const people = context.people;
  if (!people.length) return { kind: "unsupported", reply: "I can reorder moments, change music or framing, and adjust clips. This film has no confirmed people to focus on yet.", ops: [] };
  const text = req.text;
  const everyone = /\b(?:everyone|everybody|family|all (?:the )?people|all of us)\b/i.test(text);
  const matched = people.filter(person => person.name && mentionsPerson(text, person.name));
  const requested = everyone ? people : matched;
  if (!requested.length) return { kind: "clarify", reply: `Who should I focus on? Choose Everyone or a confirmed person: ${people.map(person => person.name || person.role).join(", ")}.`, ops: [] };
  if (!everyone && matched.some(person => people.filter(candidate => candidate.name?.toLocaleLowerCase() === person.name!.toLocaleLowerCase()).length > 1)) {
    return { kind: "clarify", reply: "I found more than one person with that name. Which one should I focus on?", ops: [] };
  }
  const wanted = new Set(requested.map(person => person.personId));
  const candidates = new Map(context.candidates.map(candidate => [candidate.shotId, candidate]));
  const relevantIds = context.scope.kind === "film" ? undefined : new Set(context.selected?.shotIds ?? []);
  const clipMatches = req.timeline.videoClips.map(clip => {
    const id = "kind" in clip ? clip.clipId : clip.id;
    const shotIds = "kind" in clip ? clip.spec.slots.flatMap(slot => slot.shotId ? [slot.shotId] : []) : [clip.source.shotId];
    const peopleInClip = new Set(shotIds.flatMap(shotId => candidates.get(shotId)?.personIds ?? []));
    const matchedCount = [...wanted].filter(personId => peopleInClip.has(personId)).length;
    return { id, shotIds, matchedCount, personIds: [...peopleInClip] };
  });
  if (context.scope.kind === "slot") {
    const candidate = context.candidates.find(item => item.kind === "photo" && item.personIds.some(id => wanted.has(id)) && !relevantIds?.has(item.shotId));
    if (!candidate) return { kind: "clarify", reply: "I couldn't find another confirmed photo of that person for this collage. I can focus the whole film on them instead.", ops: [] };
    return { kind: "edit", reply: `I'll feature ${everyone ? "everyone" : requested.map(person => person.name || person.role).join(" and ")} in this collage.`, ops: [{ op: "replaceCollageSlot", clipId: context.scope.clipId, slotId: context.scope.slotId, shotId: candidate.shotId, kind: "photo", ...(candidate.width ? { width: candidate.width } : {}), ...(candidate.height ? { height: candidate.height } : {}) }] };
  }
  if (context.scope.kind === "clip") {
    const selectedScope = context.scope;
    const selected = clipMatches.find(clip => clip.id === selectedScope.clipId);
    if (selected?.matchedCount === wanted.size) return { kind: "clarify", reply: "This moment already includes the requested focus. I can replace it with another matching moment if you want.", ops: [] };
    const current = req.timeline.videoClips.find(clip => ("kind" in clip ? clip.clipId : clip.id) === selectedScope.clipId);
    const missing = new Set(requested.map(person => person.personId).filter(id => !selected?.personIds.includes(id)));
    const candidate = context.candidates.filter(item => item.personIds.some(id => missing.has(id)) && (!current || ("kind" in current ? item.kind === "photo" : item.kind === current.source.kind)) && !selected?.shotIds.includes(item.shotId))
      .sort((a, b) => b.personIds.filter(id => missing.has(id)).length - a.personIds.filter(id => missing.has(id)).length)[0];
    if (candidate && current && !("kind" in current)) return { kind: "edit", reply: `I'll use a moment featuring ${requested.map(person => person.name || person.role).join(" and ")}.`, ops: [{ op: "swapShot", clipId: selectedScope.clipId, shotId: candidate.shotId, kind: candidate.kind, ...(candidate.width ? { width: candidate.width } : {}), ...(candidate.height ? { height: candidate.height } : {}) }] };
    if (candidate && current && "kind" in current) {
      const slot = [...current.spec.slots].reverse().find(item => !item.empty && (!item.shotId || !candidates.get(item.shotId)?.personIds.some(id => missing.has(id))));
      if (slot) return { kind: "edit", reply: `I'll add a photo featuring ${candidate.personIds.filter(id => missing.has(id)).map(id => requested.find(person => person.personId === id)?.name ?? "that person").join(" and ")} to this collage.`, ops: [{ op: "replaceCollageSlot", clipId: selectedScope.clipId, slotId: slot.slotId, shotId: candidate.shotId, kind: "photo", ...(candidate.width ? { width: candidate.width } : {}), ...(candidate.height ? { height: candidate.height } : {}) }] };
    }
    return { kind: "clarify", reply: "I couldn't find a matching moment to use here. I can move matching moments toward the start of the whole film instead.", ops: [] };
  }
  const available = clipMatches.filter(clip => clip.matchedCount > 0);
  if (!available.length) return { kind: "clarify", reply: "I couldn't find any moments featuring those confirmed people. I can still change the framing, soundtrack, or clip order.", ops: [] };
  // For Everyone, favor moments with more distinct confirmed people; for a
  // named focus, place matching moments first. Keep the current order on ties.
  const ranked = [...clipMatches].sort((a, b) => b.matchedCount - a.matchedCount || clipMatches.indexOf(a) - clipMatches.indexOf(b));
  const order = clipMatches.map(clip => clip.id);
  const ops: EditOp[] = [];
  ranked.forEach((clip, toIndex) => {
    const fromIndex = order.indexOf(clip.id);
    if (fromIndex !== toIndex) {
      ops.push({ op: "move", clipId: clip.id, toIndex });
      order.splice(fromIndex, 1);
      order.splice(toIndex, 0, clip.id);
    }
  });
  return ops.length
    ? { kind: "edit", reply: `I'll bring moments featuring ${everyone ? "everyone" : requested.map(person => person.name || person.role).join(" and ")} forward.`, ops }
    : { kind: "clarify", reply: "The current order already brings the requested focus forward. Tell me if you want a different edit.", ops: [] };
}

function durationRequest(text: string): number | null {
  const match = text.match(/\b(?:(?:to|at|of)\s+)?(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return value * (/^(?:m|min|minute)/i.test(match[2]!) ? 60 : 1);
}

/** Handle duration and pace requests with bounded operations that the editor already applies. */
function timingEdit(req: InterpretEditRequest): InterpretEditResult | null {
  const text = req.text;
  const targetDuration = durationRequest(text);
  const pace = /\b(?:faster|quicker|speed(?:ier)? up|more upbeat)\b/i.test(text) ? 0.8
    : /\b(?:slower|more slowly|slow down|more relaxed)\b/i.test(text) ? 1.2 : null;
  if (targetDuration === null && pace === null) return null;

  const scope = req.groundedContext?.scope ?? req.scope ?? { kind: "film" as const };
  const allClips = req.timeline.videoClips;
  const clips = scope.kind === "film" || isWholeFilmRequest(text) ? allClips : allClips.filter(clip =>
    ("kind" in clip ? clip.clipId : clip.id) === scope.clipId);
  const adjustable = clips.filter(clip => "kind" in clip || clip.source.kind === "photo");
  if (!adjustable.length) return { kind: "clarify", reply: "I can retime photos and collages, but this selection has no adjustable moments. Select a photo or collage, or ask me to change the whole film.", ops: [] };
  if (adjustable.length > 20) return { kind: "unsupported", reply: "I can retime up to 20 photos or collages in one edit. Select a smaller group or ask me to change a specific moment.", ops: [] };

  const round = (n: number) => Math.round(n * 10) / 10;
  let factor: number;
  let desiredDuration: number | null = null;
  let fixedDuration = 0;
  if (targetDuration !== null) {
    if (!Number.isFinite(targetDuration) || targetDuration <= 0 || targetDuration > 600) {
      return { kind: "clarify", reply: "Choose a film length between 1 second and 10 minutes, and I can retime its photos and collages.", ops: [] };
    }
    if (scope.kind !== "film" && !isWholeFilmRequest(text)) {
      factor = targetDuration / (adjustable[0]!.durationSec);
      desiredDuration = targetDuration;
    } else {
      fixedDuration = allClips.filter(clip => !("kind" in clip) && clip.source.kind === "video").reduce((sum, clip) => sum + clip.durationSec, 0);
      const adjustableDuration = adjustable.reduce((sum, clip) => sum + clip.durationSec, 0);
      if (targetDuration <= fixedDuration) return { kind: "clarify", reply: "That length is shorter than the film’s video moments. I can retime its photos and collages to a longer target.", ops: [] };
      factor = (targetDuration - fixedDuration) / adjustableDuration;
      desiredDuration = targetDuration - fixedDuration;
    }
  } else factor = pace!;

  const values = adjustable.map(clip => round(Math.max(0.5, Math.min("kind" in clip ? 600 : 6, clip.durationSec * factor))));
  if (desiredDuration !== null) {
    let difference = round(desiredDuration - values.reduce((sum, value) => sum + value, 0));
    for (let index = values.length - 1; index >= 0 && Math.abs(difference) >= 0.1; index--) {
      const clip = adjustable[index]!;
      const min = 0.5, max = "kind" in clip ? 600 : 6;
      while (Math.abs(difference) >= 0.1 && values[index]! + (difference > 0 ? 0.1 : -0.1) >= min && values[index]! + (difference > 0 ? 0.1 : -0.1) <= max) {
        const adjustment = difference > 0 ? 0.1 : -0.1;
        values[index] = round(values[index]! + adjustment);
        difference = round(difference - adjustment);
      }
    }
    if (Math.abs(difference) > 0.1) return { kind: "clarify", reply: "That total length can’t be reached within the supported photo and collage durations. Try a nearby film length, or ask me to retime a specific moment.", ops: [] };
  }
  const ops: EditOp[] = adjustable.map((clip, index) => {
    const value = values[index]!;
    return "kind" in clip ? { op: "setCollageDuration", clipId: clip.clipId, sec: value }
      : { op: "setPhotoDuration", clipId: clip.id, sec: value };
  });
  if (ops.every((op, index) => "sec" in op && op.sec === adjustable[index]!.durationSec)) {
    return { kind: "clarify", reply: "Those photos and collages are already at the closest supported timing. I can reorder moments, change framing or collage layout, or adjust music.", ops: [] };
  }
  if (targetDuration !== null && scope.kind !== "film" && !isWholeFilmRequest(text) && Math.abs(values[0]! - targetDuration) > 0.1) {
    return { kind: "clarify", reply: "A photo can be 0.5–6 seconds and a collage can be at least 0.5 seconds. Choose a length within that range for this moment.", ops: [] };
  }
  const applied = applyEdits(req.timeline, ops);
  if (!applied.ok || (targetDuration !== null && (scope.kind === "film" || isWholeFilmRequest(text)) && Math.abs(applied.timeline.durationSec - targetDuration) > 0.11)) {
    return { kind: "clarify", reply: "That total length can’t be reached within the supported photo and collage durations. Try a nearby film length, or ask me to retime a specific moment.", ops: [] };
  }
  return { kind: "edit", reply: targetDuration !== null ? `I’ll set the ${scope.kind === "film" || isWholeFilmRequest(text) ? "film" : "selected moment"} to about ${targetDuration} seconds.` : `I’ll make the selected ${scope.kind === "film" || isWholeFilmRequest(text) ? "film" : "moments"} ${pace! < 1 ? "faster" : "slower"}.`, ops };
}

function unavailableFeature(text: string): boolean {
  return /\b(?:captions?|subtitles?|transitions?|titles?|cover(?:s)?|filters?|color grade|colour grade)\b/i.test(text);
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
  if (unavailableFeature(req.text)) return { kind: "unsupported", reply: unavailableFeatureReply, ops: [] };
  const focus = focusEdit(req);
  if (focus) return focus;
  const timing = timingEdit(req);
  if (timing) return timing;
  if (req.groundedContext && hasAmbiguousPerson(req.text, req.groundedContext.people)) {
    return { kind: "clarify", reply: "Which person did you mean?", ops: [] };
  }
  try {
    const filmWide = isWholeFilmRequest(req.text) && req.scope?.kind !== "film";
    const scope = filmWide ? { kind: "film" as const } : req.scope;
    const request = { ...req, scope };
    const responseSchema = responseSchemaFor();
    const result = validate(await deps.generate({
      model: MODELS.analyze,
      stage: "editor.interpret",
      thinking: "MINIMAL",
      maxSchemaRepairs: 0,
      contents: [{ text: `Translate the user's request into a small ordered list of allowed edit operations for this film. Return kind=edit with a complete supported batch, kind=clarify for an ambiguous reference, or kind=unsupported for unavailable capabilities. Never return partial operations. The editor can replace, add, remove, duplicate, reorder, trim, or retime moments; change aspect ratio; change collage layout, motion, effects, and cells; reframe photos; and choose or adjust soundtrack music. Use these operations whenever requested. Do not claim a supported timeline edit is impossible or a design limitation. Use only IDs from the allowed IDs block; never invent an ID. For addCollageSlot, use the literal slotId "new-slot"; the editor assigns its internal slot id. Preserve current collage sources unless changing them is necessary. For "add more collage", use addCollageSlot with an unused owned photo candidate when one is available; otherwise ask which photos to include. Check collage capacity before adding; if full, choose a layout with enough slots and a compatible motion from the approved combinations below, or ask whether to add the photos as a new collage. Prefer the smallest number of operations and return no more than 20. The clips summary and clipIds list use the same order. Respect selected scope when resolving "this". An explicit request for all clips or the whole film can affect clips outside the selected clip. For collage layouts and motions, keep the selected layout-motion pair in this allowed list: ${JSON.stringify(ALLOWED_COMBOS)}. Reply briefly and factually. If the request refers to captions, transitions, overall pace, or another value with no edit operation, say so briefly and offer a nearby supported change.\nAllowed operation schema: ${JSON.stringify(responseSchema)}\nAllowed IDs: ${JSON.stringify(allowedIdsFor(req))}\nClips: ${JSON.stringify(compactTimeline(req.timeline))}\nGrounded context (owned candidates, confirmed people, story, soundtracks, prior conversation): ${JSON.stringify(promptContext(req))}\nScope: ${JSON.stringify(request.scope?.kind === "clip" ? { kind: "clip", clipIndex: allowedIdsFor(req).clipIds.indexOf(request.scope.clipId) } : request.scope?.kind === "slot" ? { kind: "slot", clipIndex: allowedIdsFor(req).clipIds.indexOf(request.scope.clipId), slotIndex: allowedIdsFor(req).slotIds.indexOf(request.scope.slotId) } : { kind: "film" })}\nRequest: ${req.text}` }],
      responseSchema,
      validate,
    }));
    const context = req.groundedContext;
    const allowedIds = allowedIdsFor(req);
    const foreignReference = opsReferenceClarification(result.ops, allowedIds);
    if (foreignReference) return { kind: "clarify", reply: foreignReference, ops: [] };
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
    if (result.kind === "unsupported") {
      const reply = result.reply?.trim() ?? "";
      const offersSupportedEdit = /\b(?:reorder|retime|swap|replace|frame|collage|soundtrack|music)\b/i.test(reply);
      return { kind: "unsupported", reply: reply && offersSupportedEdit ? reply : fallbackReply, ops: [] };
    }
    if (ops.length > 20 || !ops.length) return { kind: "unsupported", reply: fallbackReply, ops: [] };
    if (invalidContextOp && ops.some((op) => op.op === "addCollageSlot")) return { kind: "clarify", reply: "Which unused photos from this project should I add to the collage?", ops: [] };
    if (invalidContextOp) return { kind: "unsupported", reply: "That clip or photo isn't available here. I can use project photos, reorder moments, change framing or collage layout, or adjust music.", ops: [] };
    const capacityFit = fitAddedCollageSlots(req.timeline, ops, req.groundedContext?.candidates ?? []);
    if (capacityFit.clarify) return { kind: "clarify", reply: capacityFit.clarify, ops: [] };
    const fittedOps = capacityFit.ops;
    const applied = applyEdits(req.timeline, fittedOps);
    if (!applied.ok) {
      console.warn("Ask AI edit could not be applied", { error: applied.error, opIndex: applied.opIndex });
      return { kind: "unsupported", reply: "I couldn't apply that combination. I can reorder or retime clips, change framing or collage layout, swap a project photo, or adjust music.", ops: [] };
    }
    return { kind: "edit", reply: result.reply?.trim() || "Here are the edits I suggest.", ops: fittedOps };
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

function fitAddedCollageSlots(timeline: Timeline, ops: EditOp[], candidates: NonNullable<InterpretEditRequest["groundedContext"]>["candidates"] = []): { ops: EditOp[]; clarify?: string } {
  const candidateByShot = new Map(candidates.map((candidate) => [candidate.shotId, candidate]));
  const frameAspect = timeline.aspect === "16:9" ? 16 / 9 : 9 / 16;
  const sourceAspect = (slot: { shotId?: string; width?: number; height?: number }) => {
    const candidate = slot.shotId ? candidateByShot.get(slot.shotId) : undefined;
    const width = slot.width ?? candidate?.width, height = slot.height ?? candidate?.height;
    return width && height ? width / height : frameAspect;
  };
  const layoutCost = (layoutId: string, slots: Array<{ shotId?: string; width?: number; height?: number }>) => {
    const sourceAspects = slots.map(sourceAspect);
    const targets = collageSlotAspects(layoutId, layoutId, slots.length, frameAspect);
    const assignment = assignCollageSlots(sourceAspects, targets);
    return assignment.reduce((sum, slotIndex, sourceIndex) => sum + Math.abs(Math.log(sourceAspects[sourceIndex]! / (targets[slotIndex] ?? sourceAspects[sourceIndex]!))), 0);
  };
  const fitted: EditOp[] = [];
  for (const op of ops) {
    if (op.op === "addCollageSlot") {
      const before = applyEdits(timeline, fitted);
      if (before.ok) {
        const target = before.timeline.videoClips.find((clip) => "kind" in clip && clip.clipId === op.clipId);
        const addResult = applyEdits(before.timeline, [op]);
        if (target && "kind" in target && !addResult.ok && /This layout holds up to \d+ photos/.test(addResult.error)) {
          const needed = target.spec.slots.length + 1;
          const videoCount = target.spec.slots.filter((slot) => slot.kind === "video").length + (op.kind === "video" ? 1 : 0);
          const previewSlots = [...target.spec.slots, { slotId: op.slotId, shotId: op.shotId, kind: op.kind }];
          const choices = ALLOWED_COMBOS.flatMap((combo) => {
            const layout = COLLAGE_LAYOUTS.find((item) => item.id === combo.layoutId)!;
            return layout.maxSlots >= needed && layout.maxVideoCells >= videoCount && layout.aspect.some((aspect) => aspect === before.timeline.aspect)
              ? [{ ...combo, maxSlots: layout.maxSlots, sameMotion: combo.motionId === target.spec.motionId, fit: layoutCost(layout.id, previewSlots) }]
              : [];
          }).sort((a, b) => a.fit - b.fit || Number(b.sameMotion) - Number(a.sameMotion) || a.maxSlots - b.maxSlots || a.layoutId.localeCompare(b.layoutId));
          const selected = choices[0];
          if (!selected) return { ops: [], clarify: "That collage is full - add these as a new collage instead?" };
          fitted.push({ op: "setCollageLayout", clipId: op.clipId, layoutId: selected.layoutId });
          if (selected.motionId !== target.spec.motionId) fitted.push({ op: "setCollageMotion", clipId: op.clipId, motionId: selected.motionId });
        }
      }
    }
    fitted.push(op);
  }
  const planned = applyEdits(timeline, fitted);
  if (!planned.ok) return { ops: fitted };
  const affected = new Set(fitted.flatMap((op) => ["addCollageSlot", "replaceCollageSlot", "setCollageLayout", "setCollageSpec"].includes(op.op) && "clipId" in op ? [op.clipId] : []));
  for (const clip of planned.timeline.videoClips) {
    if (!("kind" in clip) || !affected.has(clip.clipId)) continue;
    const enriched = clip.spec.slots.map((slot) => {
      const candidate = slot.shotId ? candidateByShot.get(slot.shotId) : undefined;
      return { ...slot, ...(slot.width || !candidate?.width ? {} : { width: candidate.width }), ...(slot.height || !candidate?.height ? {} : { height: candidate.height }) };
    });
    const aspects = collageSlotAspects(clip.spec.layoutId, clip.spec.layoutId, enriched.length, frameAspect);
    const assignment = assignCollageSlots(enriched.map(sourceAspect), aspects);
    const ordered = enriched.map((slot, sourceIndex) => ({ slot, sourceIndex })).sort((a, b) => assignment[a.sourceIndex]! - assignment[b.sourceIndex]!).map(({ slot }) => slot);
    const changed = ordered.some((slot, index) => slot.slotId !== clip.spec.slots[index]?.slotId || slot.width !== clip.spec.slots[index]?.width || slot.height !== clip.spec.slots[index]?.height);
    if (changed) fitted.push({ op: "setCollageSpec", clipId: clip.clipId, spec: { ...clip.spec, slots: ordered } });
  }
  return { ops: fitted };
}
