import { describe, expect, it } from "vitest";
import { lateVideoDecision, lateVideoWindow } from "./lateJoin.js";

describe("late video join decisions", () => {
  it("inserts once into an unsaved, unedited film", () => {
    expect(lateVideoDecision({ status: "playable", composedRevision: 0, currentRevision: 0, hasShot: true })).toBe("insert");
  });
  it("offers a saved film for explicit add", () => {
    expect(lateVideoDecision({ status: "saved", composedRevision: 0, currentRevision: 0, hasShot: true })).toBe("offer");
  });
  it("offers rather than overwriting an edit made since composition", () => {
    expect(lateVideoDecision({ status: "playable", composedRevision: 0, currentRevision: 1, hasShot: true })).toBe("offer");
  });
  it("keeps auto-inserting subsequent videos after its own prior revision", () => {
    expect(lateVideoDecision({ status: "playable", composedRevision: 0, currentRevision: 1, lastAutoRevision: 1, hasShot: true })).toBe("insert");
  });
  it("skips missing footage and non-playable generations", () => {
    expect(lateVideoDecision({ status: "playable", composedRevision: 0, currentRevision: 0, hasShot: false })).toBe("skip");
    expect(lateVideoDecision({ status: "composing", composedRevision: 0, currentRevision: 0, hasShot: true })).toBe("skip");
  });
  it("skips a video already joined when a readiness task is retried", () => {
    expect(lateVideoDecision({ status: "playable", composedRevision: 0, currentRevision: 1, hasShot: true, alreadyJoined: true })).toBe("skip");
  });
  it("selects a best window with the existing compose helper", () => {
    const shot = { startSec: 0, endSec: 8, highlights: [{ startSec: 5, endSec: 7, score: 1 }] };
    expect(lateVideoWindow(shot, 3)).toMatchObject({ inSec: expect.any(Number), outSec: expect.any(Number), score: expect.any(Number) });
    expect(lateVideoWindow(shot, 3)!.inSec).toBeGreaterThan(3);
  });
});
