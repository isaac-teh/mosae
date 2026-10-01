import { analysisSearchText, type ShotAnalysis } from "../domain/understanding.js";
import { MODELS } from "../gemini/pricing.js";
export type EmbedContent = (input: { model: string; contents: string[]; taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" }) => Promise<number[][]>;
export type EmbedImageContent = (input: { model: string; jpeg: Buffer }) => Promise<number[]>;
export type EmbeddedShot = { shotId: string; embedding: number[] | null };

export async function embedImages(embedContent: EmbedImageContent, images: { id: string; jpeg: Buffer }[]): Promise<Map<string, number[]>> {
  const vectors = new Map<string, number[]>();
  await Promise.all(images.map(async ({ id, jpeg }) => {
    try {
      const vector = await embedContent({ model: MODELS.embed, jpeg });
      if (vector.length > 0) vectors.set(id, vector);
    } catch {
      // A single bad crop should not discard the other faces from this photo.
    }
  }));
  return vectors;
}

export async function embedShotAnalyses(embedContent: EmbedContent, shots: { shotId: string; analysis: ShotAnalysis }[]): Promise<EmbeddedShot[]> {
  const texts = shots.map((shot) => ({ shotId: shot.shotId, text: analysisSearchText(shot.analysis) }));
  const present = texts.filter((shot) => shot.text.trim().length > 0);
  if (present.length === 0) return texts.map(({ shotId }) => ({ shotId, embedding: null }));
  const vectors = await embedContent({ model: MODELS.embed, contents: present.map(({ text }) => text), taskType: "RETRIEVAL_DOCUMENT" });
  const byId = new Map(present.map((shot, index) => [shot.shotId, vectors[index] ?? null]));
  return texts.map(({ shotId }) => ({ shotId, embedding: byId.get(shotId) ?? null }));
}
export async function embedText(embedContent: EmbedContent, text: string): Promise<number[]> {
  const [vector] = await embedContent({ model: MODELS.embed, contents: [text], taskType: "RETRIEVAL_QUERY" });
  return vector ?? [];
}
