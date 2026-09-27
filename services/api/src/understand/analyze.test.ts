import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { UsageRecord } from "../gemini/client.js";
import { analyzePhoto, analyzeVideo } from "./analyze.js";

const deps = (generateContent: ReturnType<typeof vi.fn>) => {
  const usage: UsageRecord[] = [];
  return { generateContent, recordUsage: (record: UsageRecord) => { usage.push(record); }, sleep: async () => {} };
};
const reply = (text: string) => ({ text, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 0, totalTokenCount: 15 } });
const photoJson = JSON.stringify({ caption: "A family on a beach", subjects: [{ peopleCount: 2, roles: ["parent"], attributes: ["smiling"] }], setting: "beach", activities: ["walking"], mood: "calm", shotType: "wide", aesthetics: 4, keyMomentScore: 3, tags: ["beach"] });
const videoJson = (count: number) => JSON.stringify({ shots: Array.from({ length: count }, (_, i) => ({ description: `shot ${i}`, camera: "handheld", role: "A_ROLL", subjects: ["child"], emotion: "happy", quality: 4, usable: true, reason: "clear" })), transcript: [{ startSec: 0, endSec: 1, text: "hello" }] });

describe("Gemini shot analysis", () => {
  it("sends a photo inline and returns its validated analysis", async () => {
    const generateContent = vi.fn().mockResolvedValue(reply(photoJson));
    const dir = await mkdtemp(path.join(tmpdir(), "mosae-analyze-test-"));
    try {
      const renderPath = path.join(dir, "render.jpg");
      await writeFile(renderPath, "jpeg-bytes");
      const result = await analyzePhoto(deps(generateContent), { assetId: "a1", shotId: "s1", renderPath });
      expect(result).toMatchObject({ kind: "photo", caption: "A family on a beach" });
      const [request] = generateContent.mock.calls[0];
      expect(request.contents[1].inlineData.mimeType).toBe("image/jpeg");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("repairs a video response that has the wrong number of known shots", async () => {
    const generateContent = vi.fn().mockResolvedValueOnce(reply(videoJson(1))).mockResolvedValueOnce(reply(videoJson(2)));
    const result = await analyzeVideo(deps(generateContent), { assetId: "a1", file: { uri: "gs://x/file", mimeType: "video/mp4" }, shotCount: 2, durationSec: 5 });
    expect(result.shots).toHaveLength(2);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("fails rather than assigning a mismatched response to the wrong shots", async () => {
    const generateContent = vi.fn().mockResolvedValue(reply(videoJson(1)));
    await expect(analyzeVideo(deps(generateContent), { assetId: "a1", file: { uri: "gs://x", mimeType: "video/mp4" }, shotCount: 3, durationSec: 5 })).rejects.toThrow("expected 3 shots, got 1");
  });

  it("extracts per-face attributes and maps interactions to faceIds", async () => {
    const enrichedJson = JSON.stringify({
      caption: "c",
      subjects: ["man", "girl"],
      setting: "beach",
      activities: [],
      mood: "joyful",
      shotType: "wide",
      aesthetics: 4,
      keyMomentScore: 5,
      tags: [],
      faces: [
        { bbox: [100, 100, 300, 300], confidence: 0.9, ageBand: "adult", appearance: "blue shirt", prominence: "primary", expression: "smiling", lookingAtCamera: true },
        { bbox: [400, 400, 600, 600], confidence: 0.8, ageBand: "kid", prominence: "primary" },
      ],
      interactions: [{ from: 0, to: 1, kind: "carrying" }, { from: 0, to: 9, kind: "hugging" }],
    });
    const generateContent = vi.fn().mockResolvedValue(reply(enrichedJson));
    const dir = await mkdtemp(path.join(tmpdir(), "mosae-analyze-test-"));
    try {
      const renderPath = path.join(dir, "render.jpg");
      await writeFile(renderPath, "jpeg-bytes");
      const result = await analyzePhoto(deps(generateContent), { assetId: "a1", shotId: "s1", renderPath });
      expect(result.faces?.[0]).toEqual({
        faceId: "s1-0",
        bbox: [0.1, 0.1, 0.3, 0.3],
        confidence: 0.9,
        ageBand: "adult",
        appearance: "blue shirt",
        prominence: "primary",
        expression: "smiling",
        lookingAtCamera: true,
      });
      expect(result.faces?.[1]).toEqual({
        faceId: "s1-1",
        bbox: [0.4, 0.4, 0.6, 0.6],
        confidence: 0.8,
        prominence: "primary",
      });
      expect(result.interactions).toEqual([
        { from: "s1-0", to: "s1-1", kind: "carrying" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects aesthetics scores outside 1-5 integers rather than clamping", async () => {
    const invalidJson = JSON.stringify({
      caption: "c",
      subjects: ["man"],
      setting: "beach",
      activities: [],
      mood: "calm",
      shotType: "wide",
      aesthetics: 8.5,
      keyMomentScore: 5,
      tags: [],
    });
    const generateContent = vi.fn().mockResolvedValue(reply(invalidJson));
    const dir = await mkdtemp(path.join(tmpdir(), "mosae-analyze-test-"));
    try {
      const renderPath = path.join(dir, "render.jpg");
      await writeFile(renderPath, "jpeg-bytes");
      await expect(analyzePhoto(deps(generateContent), { assetId: "a1", shotId: "s1", renderPath })).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

