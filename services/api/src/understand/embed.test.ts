import { describe, expect, it, vi } from "vitest";
import type { PhotoAnalysis } from "../domain/understanding.js";
import { embedShotAnalyses, embedText } from "./embed.js";
const photo = (caption: string): PhotoAnalysis => ({ kind: "photo", caption, subjects: [], setting: "", activities: [], mood: "", shotType: "", aesthetics: 3, keyMomentScore: 3, tags: [] });
describe("embedding helpers", () => {
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
