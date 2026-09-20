import { describe, it, expect } from "vitest";
import {
  buildOriginalPath,
  isValidId,
  parseOriginalPath,
  workKey,
  PIPELINE_VERSION,
  STAGE_PATHS,
} from "./ids.js";

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
    expect(() => buildOriginalPath({ ...p, assetId: "a/1" })).toThrow(
      "invalid id",
    );
  });
});

describe("isValidId", () => {
  it("accepts storage-safe IDs and rejects unsafe values", () => {
    expect(isValidId("asset_123-abc")).toBe(true);
    expect(isValidId("asset/123")).toBe(false);
    expect(isValidId("")).toBe(false);
  });
});

describe("workKey", () => {
  it("includes every identity component", () => {
    expect(
      workKey({
        projectId: "p1",
        subjectKind: "asset",
        subjectId: "a1",
        generation: "17",
        stage: "ingest",
        pipelineVersion: PIPELINE_VERSION,
      }),
    ).toBe("p1:asset:a1:17:ingest:1");
  });

  it("never collides between subject kinds that share an id", () => {
    const common = { projectId: "p1", subjectId: "x1", generation: "1", stage: "plan" as const, pipelineVersion: PIPELINE_VERSION };
    const asset = workKey({ ...common, subjectKind: "asset" });
    const job = workKey({ ...common, subjectKind: "job" });
    expect(asset).not.toBe(job);
  });

  it("never collides between stages for the same subject", () => {
    const common = { projectId: "p1", subjectKind: "asset" as const, subjectId: "a1", generation: "1", pipelineVersion: PIPELINE_VERSION };
    expect(workKey({ ...common, stage: "ingest" })).not.toBe(workKey({ ...common, stage: "understand" }));
  });
});

describe("STAGE_PATHS", () => {
  it("routes every stage to a distinct task path", () => {
    const paths = Object.values(STAGE_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
    expect(STAGE_PATHS.ingest).toBe("/tasks/ingest");
    expect(STAGE_PATHS.render).toBe("/tasks/render");
  });
});
