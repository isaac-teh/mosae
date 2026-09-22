import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { PhotoAnalysis, TranscriptLine, VideoShotAnalysis } from "../domain/understanding.js";
import { generateStructured, type GenerateDeps } from "../gemini/client.js";
import { MODELS } from "../gemini/pricing.js";

const photoPrompt = "Analyze this photo for a family-memory shot catalog. Do not identify people by name. Be concise and only describe visible evidence.";
const videoPrompt = (count: number, duration: number) => `Analyze this video, already split into exactly ${count} shots in order. Return one analysis object per shot, in the same order, plus a transcript of audible speech with timestamps. Keep every timestamp within duration ${duration.toFixed(2)} seconds. Do not identify people by name.`;
const photoSchema = z.strictObject({ caption: z.string().min(1), subjects: z.array(z.strictObject({ peopleCount: z.number().int().min(0), roles: z.array(z.string()), attributes: z.array(z.string()) })), setting: z.string().min(1), activities: z.array(z.string()), mood: z.string().min(1), shotType: z.string().min(1), aesthetics: z.number().min(1).max(5), keyMomentScore: z.number().min(1).max(5), tags: z.array(z.string()) });
const videoShotSchema = z.strictObject({ description: z.string().min(1), camera: z.string().min(1), role: z.enum(["A_ROLL", "B_ROLL"]), subjects: z.array(z.string()), emotion: z.string().min(1), quality: z.number().min(1).max(5), usable: z.boolean(), reason: z.string().min(1) });
const videoSchema = z.strictObject({ shots: z.array(videoShotSchema), transcript: z.array(z.strictObject({ startSec: z.number().min(0), endSec: z.number().min(0), text: z.string() })) });
const photoResponseSchema = { type: "object", properties: { caption: { type: "string" }, subjects: { type: "array" }, setting: { type: "string" }, activities: { type: "array" }, mood: { type: "string" }, shotType: { type: "string" }, aesthetics: { type: "number" }, keyMomentScore: { type: "number" }, tags: { type: "array" } }, required: ["caption", "subjects", "setting", "activities", "mood", "shotType", "aesthetics", "keyMomentScore", "tags"] };
const videoResponseSchema = { type: "object", properties: { shots: { type: "array" }, transcript: { type: "array" } }, required: ["shots", "transcript"] };

export async function analyzePhoto(deps: GenerateDeps, input: { assetId: string; renderPath: string }): Promise<PhotoAnalysis> {
  const bytes = await readFile(input.renderPath);
  const value = await generateStructured({ model: MODELS.analyze, stage: "understand.analyze", subjectId: input.assetId, contents: [{ text: photoPrompt }, { inlineData: { mimeType: "image/jpeg", data: bytes.toString("base64") } }], responseSchema: photoResponseSchema, validate: (value) => photoSchema.parse(value), thinking: "LOW" }, deps);
  return { kind: "photo", ...value };
}
export type VideoFile = { uri: string; mimeType: string };
export async function analyzeVideo(deps: GenerateDeps, input: { assetId: string; file: VideoFile; shotCount: number; durationSec: number }): Promise<{ shots: VideoShotAnalysis[]; transcript: TranscriptLine[] }> {
  const parsed = await generateStructured({ model: MODELS.analyze, stage: "understand.analyze", subjectId: input.assetId, contents: [{ text: videoPrompt(input.shotCount, input.durationSec) }, { fileData: { fileUri: input.file.uri, mimeType: input.file.mimeType } }], responseSchema: videoResponseSchema, validate: (value) => { const result = videoSchema.parse(value); if (result.shots.length !== input.shotCount) throw new Error(`expected ${input.shotCount} shots, got ${result.shots.length}`); return result; }, thinking: "LOW" }, deps);
  return { shots: parsed.shots.map((shot) => ({ kind: "video" as const, ...shot })), transcript: parsed.transcript };
}
