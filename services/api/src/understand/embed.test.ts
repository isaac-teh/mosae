import { describe, expect, it, vi } from "vitest";
import type { PhotoAnalysis } from "../domain/understanding.js";
import { embedShotAnalyses, embedText } from "./embed.js";
const photo = (caption: string): PhotoAnalysis => ({ kind: "photo", caption, subjects: [], setting: "", activities: [], mood: "", shotType: "", aesthetics: 3, keyMomentScore: 3, tags: [] });
describe("embedding helpers", () => {
  it("returns image vectors keyed by image id", async () => {
    const module = await import("./embed.js");
    const embedImages = (module as typeof module & { embedImages?: (embed: (input: { model: string; jpeg: Buffer }) => Promise<number[]>, images: { id: string; jpeg: Buffer }[]) => Promise<Map<string, number[]>> }).embedImages;
    expect(embedImages).toBeTypeOf("function");
    if (!embedImages) return;
    const embed = vi.fn(async ({ jpeg }: { model: string; jpeg: Buffer }) => [jpeg[0]!, jpeg[1]!]);
    const images = [{ id: "face-a", jpeg: Buffer.from([1, 2]) }, { id: "face-b", jpeg: Buffer.from([3, 4]) }];

    await expect(embedImages(embed, images)).resolves.toEqual(new Map([["face-a", [1, 2]], ["face-b", [3, 4]]]));
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed).toHaveBeenCalledWith({ model: "gemini-embedding-2", jpeg: images[0]!.jpeg });
  });

  it("omits an image whose embedding request fails", async () => {
    const module = await import("./embed.js");
    const embedImages = (module as typeof module & { embedImages?: (embed: (input: { model: string; jpeg: Buffer }) => Promise<number[]>, images: { id: string; jpeg: Buffer }[]) => Promise<Map<string, number[]>> }).embedImages;
    expect(embedImages).toBeTypeOf("function");
    if (!embedImages) return;
    const embed = vi.fn(async ({ jpeg }: { model: string; jpeg: Buffer }) => {
      if (jpeg[0] === 1) throw new Error("image embedding unavailable");
      return [0, 1];
    });

    const vectors = await embedImages(embed, [
      { id: "failed-face", jpeg: Buffer.from([1]) },
      { id: "good-face", jpeg: Buffer.from([2]) },
    ]);

    expect(vectors).toEqual(new Map([["good-face", [0, 1]]]));
  });

  it("batches non-empty document text and preserves skipped shots", async () => {
    const embed = vi.fn().mockResolvedValue([[1, 0]]);
    await expect(embedShotAnalyses(embed, [{ shotId: "empty", analysis: photo("") }, { shotId: "beach", analysis: photo("beach") }])).resolves.toEqual([{ shotId: "empty", embedding: null }, { shotId: "beach", embedding: [1, 0] }]);
    expect(embed).toHaveBeenCalledWith({ model: "gemini-embedding-2", contents: ["beach"], taskType: "RETRIEVAL_DOCUMENT" });
  });
  it("uses a query embedding task type", async () => {
    const embed = vi.fn().mockResolvedValue([[1, 0]]);
    await expect(embedText(embed, "beach")).resolves.toEqual([1, 0]);
    expect(embed).toHaveBeenCalledWith(expect.objectContaining({ taskType: "RETRIEVAL_QUERY" }));
  });
});
