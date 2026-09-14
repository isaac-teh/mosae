import { describe, it, expect } from "vitest";
import { buildOriginalPath, parseOriginalPath, workKey, PIPELINE_VERSION } from "./ids.js";

const p = { userId: "u1", projectId: "p1", sessionId: "s1", assetId: "a1" };

describe("original storage paths", () => {
  it("round-trips", () => {
    expect(buildOriginalPath(p)).toBe("uploads/u1/p1/s1/a1/original");
    expect(parseOriginalPath("uploads/u1/p1/s1/a1/original")).toEqual(p);
  });

  it("rejects proxies, renders, and malformed paths", () => {
    expect(parseOriginalPath("uploads/u1/p1/s1/a1/proxy.jpg")).toBeNull();
    expect(parseOriginalPath("renders/u1/p1/out.mp4")).toBeNull();
    expect(parseOriginalPath("uploads/u1/p1/a1/original")).toBeNull();
    expect(parseOriginalPath("uploads/u1/../s1/a1/original")).toBeNull();
    expect(parseOriginalPath("uploads//p1/s1/a1/original")).toBeNull();
  });

  it("rejects ids with unsafe characters when building", () => {
    expect(() => buildOriginalPath({ ...p, assetId: "a/1" })).toThrow("invalid id");
  });
});

describe("workKey", () => {
  it("includes every identity component", () => {
    expect(
      workKey({ projectId: "p1", assetId: "a1", generation: "17", stage: "ingest", pipelineVersion: PIPELINE_VERSION }),
    ).toBe("p1:a1:17:ingest:1");
  });
});
