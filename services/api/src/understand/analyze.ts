import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { PhotoAnalysis, TranscriptLine, VideoShotAnalysis } from "../domain/understanding.js";
import { generateStructured, type GenerateDeps } from "../gemini/client.js";
import { MODELS } from "../gemini/pricing.js";
import { normalizeFaces } from "./faceDetect.js";

const photoPrompt = "Analyze this photo for a family-memory shot catalog. Do not identify people by name. Be concise and only describe visible evidence. Also detect every human face in the photo and include each as an object with \"bbox\" as [ymin, xmin, ymax, xmax] in PIXELS (top-left then bottom-right corners) and \"confidence\" as a number 0–1.";
const videoPrompt = (count: number, duration: number) => `Analyze this video, already split into exactly ${count} shots in order. Return one analysis object per shot, in the same order, plus a transcript of audible speech with timestamps. Keep every timestamp within duration ${duration.toFixed(2)} seconds. Do not identify people by name.`;
const photoSchema = z.strictObject({ caption: z.string().min(1), subjects: z.array(z.strictObject({ peopleCount: z.number().int().min(0), roles: z.array(z.string()), attributes: z.array(z.string()) })), setting: z.string().min(1), activities: z.array(z.string()), mood: z.string().min(1), shotType: z.string().min(1), aesthetics: z.number().min(1).max(5), keyMomentScore: z.number().min(1).max(5), tags: z.array(z.string()), faces: z.array(z.strictObject({ bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), confidence: z.number().finite().nonnegative() })).optional() });

/**
 * Gemini's free-form output rarely matches our strict schema. This normaliser
 * bridges the gap so Zod validation can succeed without forcing the model to
 * produce a rigid object structure it doesn't know how to follow.
 */
function normalisePhoto(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) return {};
  const obj = raw as Record<string, unknown>;

  // subjects may be string[] ("young woman") or object[] — coerce to our shape.
  let subjects = obj.subjects;
  if (Array.isArray(subjects)) {
    subjects = subjects.map((item: unknown) => {
      if (typeof item === "string") return { peopleCount: 1, roles: [item], attributes: [] };
      if (typeof item === "object" && item !== null) return item;
      return { peopleCount: 0, roles: [], attributes: [] };
    });
  }

  // Clamp numeric scores to the Zod-allowed range.
  const clamp = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" ? Math.max(lo, Math.min(hi, v)) : undefined;

  return {
    ...obj,
    subjects,
    aesthetics: clamp(obj.aesthetics, 1, 5),
    keyMomentScore: clamp(obj.keyMomentScore, 1, 5),
  };
}
const videoShotSchema = z.strictObject({ description: z.string().min(1), camera: z.string().min(1), role: z.enum(["A_ROLL", "B_ROLL"]), subjects: z.array(z.string()), emotion: z.string().min(1), quality: z.number().min(1).max(5), usable: z.boolean(), reason: z.string().min(1) });
const videoSchema = z.strictObject({ shots: z.array(videoShotSchema), transcript: z.array(z.strictObject({ startSec: z.number().min(0), endSec: z.number().min(0), text: z.string() })) });
// responseJsonSchema CONSTRAINS the reply, it does not hint at it: an empty
// `properties` makes Gemini return `{}` every time. Name the fields; the Zod
// schema plus normalisePhoto below stay the gatekeeper for their contents.
const photoResponseSchema = { type: "object", properties: { caption: { type: "string" }, subjects: { type: "array" }, setting: { type: "string" }, activities: { type: "array" }, mood: { type: "string" }, shotType: { type: "string" }, aesthetics: { type: "number" }, keyMomentScore: { type: "number" }, tags: { type: "array" }, faces: { type: "array", items: { type: "object", properties: { bbox: { type: "array" }, confidence: { type: "number" } }, required: ["bbox", "confidence"] } } }, required: ["caption", "subjects", "setting", "activities", "mood", "shotType", "aesthetics", "keyMomentScore", "tags"] };
const videoResponseSchema = {
  type: "object",
  properties: {
    // `items` is not decoration: without it the model names the shot fields
    // itself and every video fails Zod on `description`.
    shots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          camera: { type: "string" },
          role: { type: "string", enum: ["A_ROLL", "B_ROLL"] },
          subjects: { type: "array", items: { type: "string" } },
          emotion: { type: "string" },
          quality: { type: "number" },
          usable: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["description", "camera", "role", "subjects", "emotion", "quality", "usable", "reason"],
      },
    },
    transcript: {
      type: "array",
      items: {
        type: "object",
        properties: { startSec: { type: "number" }, endSec: { type: "number" }, text: { type: "string" } },
        required: ["startSec", "endSec", "text"],
      },
    },
  },
  required: ["shots", "transcript"],
};

export async function analyzePhoto(deps: GenerateDeps, input: { assetId: string; shotId: string; renderPath: string }): Promise<PhotoAnalysis> {
  const bytes = await readFile(input.renderPath);
  // Step 1 of face tagging: detect faces in the SAME Gemini call as analysis.
  // Detection piggybacks on the existing Vision request (same model), so it adds
  // no new API cost beyond the analysis call already made. Gemini reports boxes
  // on a fixed 0-1000 grid, so normalising them needs no knowledge of the
  // image's real size. Stable ids require the shot id, which only the caller knows.
  const value = photoSchema.parse(normalisePhoto(await generateStructured({ model: MODELS.analyze, stage: "understand.analyze", subjectId: input.assetId, contents: [{ text: photoPrompt }, { inlineData: { mimeType: "image/jpeg", data: bytes.toString("base64") } }], responseSchema: photoResponseSchema, validate: (v) => v as unknown, thinking: "LOW" }, deps)));
  const faces = normalizeFaces(value.faces ?? []).map((face, index) => ({ faceId: `${input.shotId}-${index}`, bbox: face.bbox, confidence: face.confidence }));
  return { kind: "photo", caption: value.caption, subjects: value.subjects, setting: value.setting, activities: value.activities, mood: value.mood, shotType: value.shotType, aesthetics: value.aesthetics, keyMomentScore: value.keyMomentScore, tags: value.tags, ...(faces.length ? { faces } : {}) };
}
export type VideoFile = { uri: string; mimeType: string };
export async function analyzeVideo(deps: GenerateDeps, input: { assetId: string; file: VideoFile; shotCount: number; durationSec: number }): Promise<{ shots: VideoShotAnalysis[]; transcript: TranscriptLine[] }> {
  const parsed = await generateStructured({ model: MODELS.analyze, stage: "understand.analyze", subjectId: input.assetId, contents: [{ text: videoPrompt(input.shotCount, input.durationSec) }, { fileData: { fileUri: input.file.uri, mimeType: input.file.mimeType } }], responseSchema: videoResponseSchema, validate: (value) => { const result = videoSchema.parse(value); if (result.shots.length !== input.shotCount) throw new Error(`expected ${input.shotCount} shots, got ${result.shots.length}`); return result; }, thinking: "LOW" }, deps);
  return { shots: parsed.shots.map((shot) => ({ kind: "video" as const, ...shot })), transcript: parsed.transcript };
}
