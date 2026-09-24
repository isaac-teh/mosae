import { describe, it, expect } from "vitest";
import { GenerationSchema, safeParseGeneration } from "./generation.js";
import { DirectionSettingsSchema } from "./direction.js";

const valid = {
  schemaVersion: 1 as const,
  id: "gen1",
  projectId: "project1",
  proposalId: "proposal1",
  parentGenerationId: null,
  settings: {
    schemaVersion: 1 as const,
    id: "settings1",
    projectId: "project1",
    version: 1,
    note: "",
    cadenceId: "tender" as const,
    soundtrackId: null,
    durationId: "1m" as const,
    aspect: "9:16" as const,
    captions: false,
  },
  seed: "seed-abc",
  status: "composing" as const,
  timeline: null,
  droppedPicks: [],
  failureReasons: [],
  outputPath: null,
  renderProgress: 0,
};

describe("GenerationSchema", () => {
  it("accepts a valid generation with all fields", () => {
    const result = safeParseGeneration(valid);
    expect(result.ok).toBe(true);
  });

  it("accepts nullable parent and outputPath", () => {
    const gen = { ...valid, parentGenerationId: "gen-parent", outputPath: "gs://bucket/path.mp4" };
    expect(safeParseGeneration(gen).ok).toBe(true);
  });

  it("accepts a saved timeline", () => {
    const gen = {
      ...valid,
      status: "playable" as const,
      timeline: {
        schemaVersion: 1 as const,
        projectId: "project1",
        mode: "memory" as const,
        aspect: "9:16" as const,
        fps: 30 as const,
        durationSec: 60,
        chapters: [],
        videoClips: [{ id: "clip1", source: { kind: "photo" as const, shotId: "shot1" }, startSec: 0, durationSec: 5, transitionIn: { kind: "cut" as const, durationSec: 0 } }],
        audioClips: [],
        captions: [],
      },
    };
    expect(safeParseGeneration(gen).ok).toBe(true);
  });

  it("rejects an invalid status", () => {
    const gen = { ...valid, status: "invalid" as any };
    expect(safeParseGeneration(gen).ok).toBe(false);
  });

  it("rejects missing required fields", () => {
    const gen = { ...valid, id: "" };
    expect(safeParseGeneration(gen).ok).toBe(false);
  });

  it("rejects a timeline that fails TimelineSchema", () => {
    const gen = {
      ...valid,
      status: "playable" as const,
      timeline: { invalid: true } as any,
    };
    expect(safeParseGeneration(gen).ok).toBe(false);
  });

  it("rejects negative renderProgress", () => {
    const gen = { ...valid, renderProgress: -0.1 };
    expect(safeParseGeneration(gen).ok).toBe(false);
  });

  it("rejects renderProgress above 1", () => {
    const gen = { ...valid, renderProgress: 1.1 };
    expect(safeParseGeneration(gen).ok).toBe(false);
  });
});
