import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

const { curateStory } = await import("./curate.js");

describe("curateStory", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it("parses a valid Gemini JSON response into a CurationResult", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        selectedMediaRefs: ["gs://bucket/a.jpg", "gs://bucket/c.jpg"],
        pacing: "slow-build",
        template: "warm-nostalgic",
      }),
    });

    const result = await curateStory("our trip to the mountains", [
      "gs://bucket/a.jpg",
      "gs://bucket/b.jpg",
      "gs://bucket/c.jpg",
    ]);

    expect(result).toEqual({
      selectedMediaRefs: ["gs://bucket/a.jpg", "gs://bucket/c.jpg"],
      pacing: "slow-build",
      template: "warm-nostalgic",
    });
  });

  it("retries once on failure then succeeds", async () => {
    mockGenerateContent
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          selectedMediaRefs: ["gs://bucket/a.jpg"],
          pacing: "fast",
          template: "energetic",
        }),
      });

    const result = await curateStory("story", ["gs://bucket/a.jpg"]);

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(result.pacing).toBe("fast");
  });

  it("throws after the retry also fails", async () => {
    mockGenerateContent.mockRejectedValue(new Error("rate limited"));

    await expect(curateStory("story", ["gs://bucket/a.jpg"])).rejects.toThrow(
      "rate limited"
    );
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });
});
