import { GoogleGenAI } from "@google/genai";
import type { Firestore } from "firebase-admin/firestore";
import type { GenerateDeps, UsageRecord } from "./client.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { MODE, recordingGenerate, replayingGenerate, recordingEmbed, replayingEmbed, rememberFileUri } from "./recorder.js";
import { EMBED_DIMENSIONS } from "./pricing.js";

// ── Record and replay ──────────────────────────────────────────────
// MOCK_GEMINI=record hits the real API and saves each exchange; =replay serves
// those recordings and never contacts the API. See ./recorder.ts.

/**
 * Whether a Gemini-backed dependency can be built. A replay run serves every
 * answer from disk, so it needs no key — gating on the key alone made
 * `MOCK_GEMINI=replay` fail with `gemini_api_key_missing`, which is the one
 * error a replay must never produce.
 */
export function geminiConfigured(apiKey?: string): boolean {
  return MODE === "replay" || !!apiKey;
}

/** generateContent, wired for whichever mode this process is running in. */
export function createGeminiClient(apiKey?: string): GenerateDeps["generateContent"] {
  if (MODE === "replay") return replayingGenerate() as GenerateDeps["generateContent"];
  if (!apiKey) throw new Error("gemini_api_key_missing");
  const real = generateContentVia(createGenAI(apiKey));
  if (MODE === "record") return recordingGenerate(real as (request: unknown) => Promise<unknown>) as GenerateDeps["generateContent"];
  return real;
}

/** embedContent, wired the same way. Replay never returns a zero-length vector. */
export function createEmbedClient(apiKey?: string): (input: { model: string; contents: string[]; taskType: TaskType }) => Promise<number[][]> {
  if (MODE === "replay") return replayingEmbed();
  if (!apiKey) throw new Error("gemini_api_key_missing");
  const real = embedContentVia(createGenAI(apiKey));
  if (MODE === "record") return recordingEmbed(real);
  return real;
}

/**
 * Upload/delete for the Files API. Replay hands back a URI derived from the
 * file's bytes so the analyse request that follows normalises to the same key
 * it had when recorded; recording tells the normaliser which bytes the real
 * URI stood for, so both runs agree.
 */
export function createFileClient(apiKey?: string): {
  upload: (input: { path: string; mimeType: string }) => Promise<{ name: string; uri: string; mimeType: string }>;
  delete: (name: string) => Promise<void>;
} {
  const digestOf = async (filePath: string): Promise<string> =>
    createHash("sha256").update(await readFile(filePath)).digest("hex").slice(0, 32);

  if (MODE === "replay") return {
    upload: async (input) => {
      const digest = await digestOf(input.path);
      const uri = `mock://file/${digest}`;
      rememberFileUri(uri, digest);
      return { name: `mock/${digest}`, uri, mimeType: input.mimeType };
    },
    delete: async () => {},
  };

  if (!apiKey) throw new Error("gemini_api_key_missing");
  const client = createGenAI(apiKey);
  return {
    upload: async (input) => {
      const uploaded = await uploadAndWaitActive(client, input);
      if (MODE === "record") rememberFileUri(uploaded.uri, await digestOf(input.path));
      return uploaded;
    },
    delete: (name) => deleteFileVia(client, name),
  };
}

// ── Real client ──────────────────────────────────────────────────────────────
export function createGenAI(apiKey: string): GoogleGenAI { return new GoogleGenAI({ apiKey }); }
export function generateContentVia(client: GoogleGenAI): GenerateDeps["generateContent"] {
  return (request) => client.models.generateContent(request as Parameters<typeof client.models.generateContent>[0]);
}
export type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
/**
 * Firestore rejects a vector field wider than 2048, and gemini-embedding-2
 * returns 3072 by default — so the width has to be asked for, not accepted.
 * These models are trained so a prefix of the vector is still a good
 * embedding (Matryoshka), but only the full-width vector comes back
 * normalised, so a truncated one is re-normalised here before anyone
 * compares it by cosine distance.
 */
export { EMBED_DIMENSIONS };

function toUnitLength(values: number[]): number[] {
  let sumOfSquares = 0;
  for (const value of values) sumOfSquares += value * value;
  const length = Math.sqrt(sumOfSquares);
  return length > 0 ? values.map((value) => value / length) : values;
}

export function embedContentVia(client: GoogleGenAI): (input: { model: string; contents: string[]; taskType: TaskType }) => Promise<number[][]> {
  return async ({ model, contents, taskType }) => {
    const response = await client.models.embedContent({ model, contents, config: { taskType, outputDimensionality: EMBED_DIMENSIONS } });
    return (response.embeddings ?? []).map((embedding) => toUnitLength(embedding.values ?? []));
  };
}
export type UploadedFile = { name: string; uri: string; mimeType: string };
type FilesClient = { files: { upload(input: unknown): Promise<{ name: string; uri: string; mimeType: string; state: string }>; get(input: unknown): Promise<{ name: string; uri: string; mimeType: string; state: string }>; delete(input: unknown): Promise<unknown> } };
export async function uploadAndWaitActive(client: GoogleGenAI, input: { path: string; mimeType: string }): Promise<UploadedFile> {
  const files = (client as unknown as FilesClient).files;
  let file = await files.upload({ file: input.path, config: { mimeType: input.mimeType } });
  while (file.state === "PROCESSING") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    file = await files.get({ name: file.name });
  }
  if (file.state !== "ACTIVE") throw new Error(`upload ${input.path} did not become ACTIVE: ${file.state}`);
  return { name: file.name, uri: file.uri, mimeType: file.mimeType };
}
export async function deleteFileVia(client: GoogleGenAI, name: string): Promise<void> {
  await (client as unknown as FilesClient).files.delete({ name }).catch(() => undefined);
}
export function recordUsageToLog(db: Firestore, context: { projectId: string }): (usage: UsageRecord) => Promise<void> {
  return async (usage) => {
    const fields = Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined));
    await db.collection("geminiUsage").add({ ...fields, projectId: context.projectId, createdAt: Date.now() });
  };
}
