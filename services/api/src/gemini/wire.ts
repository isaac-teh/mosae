import { GoogleGenAI } from "@google/genai";
import type { Firestore } from "firebase-admin/firestore";
import type { GenerateDeps, UsageRecord } from "./client.js";

export function createGenAI(apiKey: string): GoogleGenAI { return new GoogleGenAI({ apiKey }); }
export function generateContentVia(client: GoogleGenAI): GenerateDeps["generateContent"] {
  return (request) => client.models.generateContent(request as Parameters<typeof client.models.generateContent>[0]);
}
export type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
export function embedContentVia(client: GoogleGenAI): (input: { model: string; contents: string[]; taskType: TaskType }) => Promise<number[][]> {
  return async ({ model, contents, taskType }) => {
    const response = await client.models.embedContent({ model, contents, config: { taskType } });
    return (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
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
  return async (usage) => { await db.collection("geminiUsage").add({ ...usage, projectId: context.projectId, createdAt: Date.now() }); };
}
