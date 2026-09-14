import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitStory } from "./api";

describe("submitStory", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.com";
  });

  it("posts to /api/curate and returns the plan id", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ planId: "plan-123" }),
    } as Response);

    const result = await submitStory("user-1", "our trip", ["gs://bucket/a.jpg"]);

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/api/curate",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "user-1",
          storyText: "our trip",
          mediaRefs: ["gs://bucket/a.jpg"],
        }),
      })
    );
    expect(result).toEqual({ planId: "plan-123" });
  });

  it("throws when the response is not ok", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);

    await expect(submitStory("user-1", "our trip", [])).rejects.toThrow(
      "curation_request_failed"
    );
  });
});
