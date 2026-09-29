import { ALLOWED_COMBOS, COLLAGE_EFFECTS, COLLAGE_LAYOUTS, COLLAGE_MOTIONS, EditOpSchema, applyEdits, type EditOp, type Timeline } from "@mosae/contracts";
import type { GenerateOptions } from "../gemini/client.js";
import { MODELS } from "../gemini/pricing.js";

export type InterpretEditRequest = { text: string; timeline: Timeline };
export type InterpretEditModelResult = { reply?: string; ops: EditOp[] };
export type InterpretEditResult = { reply: string; ops: EditOp[] };
const fallbackReply = "I couldn't turn that into an edit. Try the tools below, or say it another way.";

const operationProperties = {
  op: { type: "STRING", enum: ["swapShot", "trim", "setPhotoDuration", "move", "remove", "add", "setCollageLayout", "setCollageMotion", "setCollageEffect", "replaceCollageSlot", "splitCollage", "setSoundtrack"] },
  clipId: { type: "STRING" }, shotId: { type: "STRING" }, inSec: { type: "NUMBER" }, outSec: { type: "NUMBER" }, sec: { type: "NUMBER" }, toIndex: { type: "INTEGER" },
  kind: { type: "STRING", enum: ["photo", "video"] }, afterClipId: { type: "STRING", nullable: true }, durationSec: { type: "NUMBER" }, sourceInSec: { type: "NUMBER" }, sourceOutSec: { type: "NUMBER" },
  layoutId: { type: "STRING", enum: COLLAGE_LAYOUTS.map((layout) => layout.id) },
  motionId: { type: "STRING", enum: COLLAGE_MOTIONS.map((motion) => motion.id) },
  effectId: { type: "STRING", enum: COLLAGE_EFFECTS.map((effect) => effect.id), nullable: true }, slotId: { type: "STRING" }, soundtrackId: { type: "STRING" },
};
const responseSchema = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    ops: { type: "ARRAY", items: { type: "OBJECT", properties: operationProperties, required: ["op"], additionalProperties: false } },
  },
  required: ["ops"],
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
  const result = value as { reply?: unknown; ops: unknown[] };
  if (result.reply !== undefined && typeof result.reply !== "string") throw new Error("reply must be a string");
  const ops = result.ops.map((op) => {
    const parsed = EditOpSchema.safeParse(op);
    if (!parsed.success) throw new Error("invalid edit operation");
    return parsed.data;
  });
  return { ...(typeof result.reply === "string" ? { reply: result.reply } : {}), ops };
}

export async function interpretEdit(req: InterpretEditRequest, deps: {
  generate: (options: GenerateOptions<InterpretEditModelResult>) => Promise<unknown>;
}): Promise<InterpretEditResult> {
  try {
    const result = validate(await deps.generate({
      model: MODELS.analyze,
      stage: "editor.interpret",
      thinking: "MINIMAL",
      contents: [{ text: `Translate the user's request into a small ordered list of allowed edit operations for this film. Return only supported operations. Do not invent clip ids, shot ids, or collage slot ids; use only ids in the timeline. Preserve current layout, motion, effect, and slot sources unless changing that property is necessary to satisfy the request. Prefer the smallest number of operations. For collage layouts and motions, select an id from the schema and keep the selected layout-motion pair in this allowed list: ${JSON.stringify(ALLOWED_COMBOS)}. If the request is unclear or cannot be safely applied, return an empty ops array. Reply with a short confirmation of what the edits will do.\nAllowed operation schema: ${JSON.stringify(responseSchema)}\nClips: ${JSON.stringify(compactTimeline(req.timeline))}\nRequest: ${req.text}` }],
      responseSchema,
      validate,
    }));
    if (!result.ops.length || !applyEdits(req.timeline, result.ops).ok) return { reply: fallbackReply, ops: [] };
    return { reply: result.reply?.trim() || "Here are the edits I suggest.", ops: result.ops };
  } catch {
    return { reply: fallbackReply, ops: [] };
  }
}
