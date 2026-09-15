import { describe, it, expect, vi } from "vitest";

vi.mock("./apiClient", () => ({ apiPost: vi.fn() }));
const { apiPost } = await import("./apiClient");
const { submitStory } = await import("./api");

describe("submitStory", () => {
  it("posts the story through the authenticated API client", async () => {
    vi.mocked(apiPost).mockResolvedValue({ planId: "plan-123" });
    await expect(submitStory("our trip", ["gs://bucket/a.jpg"])).resolves.toEqual({ planId: "plan-123" });
    expect(apiPost).toHaveBeenCalledWith("/api/curate", { storyText: "our trip", mediaRefs: ["gs://bucket/a.jpg"] });
  });
});
