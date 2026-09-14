import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../gemini/curate.js", () => ({
  curateStory: vi.fn(),
}));
vi.mock("../firestore/curationPlan.js", () => ({
  saveCurationPlan: vi.fn(),
}));

const { curateStory } = await import("../gemini/curate.js");
const { saveCurationPlan } = await import("../firestore/curationPlan.js");
const { curateRouter } = await import("./curate.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/curate", curateRouter((_req, res, next) => { res.locals.userId = "user-1"; next(); }));
  return app;
}

describe("POST /api/curate", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  beforeEach(() => {
    vi.mocked(curateStory).mockReset();
    vi.mocked(saveCurationPlan).mockReset();
  });
  afterEach(() => error.mockClear());

  it("returns 201 with the saved plan id on success", async () => {
    vi.mocked(curateStory).mockResolvedValue({
      selectedMediaRefs: ["gs://bucket/a.jpg"],
      pacing: "slow-build",
      template: "warm-nostalgic",
    });
    vi.mocked(saveCurationPlan).mockResolvedValue("plan-123");

    const res = await request(buildApp())
      .post("/api/curate")
      .send({ storyText: "our trip", mediaRefs: ["gs://bucket/a.jpg"] });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ planId: "plan-123" });
    expect(saveCurationPlan).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", storyText: "our trip" })
    );
  });

  it("returns 502 when Gemini curation fails", async () => {
    vi.mocked(curateStory).mockRejectedValue(new Error("rate limited"));

    const res = await request(buildApp())
      .post("/api/curate")
      .send({ storyText: "our trip", mediaRefs: ["gs://bucket/a.jpg"] });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "curation_failed" });
    expect(error).toHaveBeenCalledWith("curation failed", expect.any(Error));
  });
});
