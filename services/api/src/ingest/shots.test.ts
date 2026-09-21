import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeVideoDerivatives } from "./proxies.js";
import { closeProbe } from "./probe.js";
import { detectShots, MIN_SHOT_SEC, parseSceneCuts, shotsFromCuts } from "./shots.js";
import { makeSceneVideo, makeVideo, tempDir } from "./testMedia.js";

describe("parseSceneCuts", () => {
  it("reads pts_time values from ffmpeg showinfo output", () => {
    const stderr = [
      "[Parsed_showinfo_1 @ 0x1] n:   0 pts:  30 pts_time:2 duration: 1",
      "noise line without a time",
      "[Parsed_showinfo_1 @ 0x1] n:   1 pts:  60 pts_time:4.033 duration: 1",
    ].join("\n");
    expect(parseSceneCuts(stderr)).toEqual([2, 4.033]);
  });

  it("returns nothing when no scene change was reported", () => {
    expect(parseSceneCuts("frame=  30 fps=0.0")).toEqual([]);
  });
});

describe("shotsFromCuts", () => {
  it("returns one shot covering the whole video when there are no cuts", () => {
    expect(shotsFromCuts([], 6)).toEqual([{ startSec: 0, endSec: 6 }]);
  });

  it("splits at each cut into contiguous shots", () => {
    expect(shotsFromCuts([2, 4], 6)).toEqual([
      { startSec: 0, endSec: 2 },
      { startSec: 2, endSec: 4 },
      { startSec: 4, endSec: 6 },
    ]);
  });

  it("ignores cuts that would leave a shot shorter than the minimum, at either end", () => {
    const shots = shotsFromCuts([0.2, 3, 5.9], 6);
    expect(shots).toEqual([
      { startSec: 0, endSec: 3 },
      { startSec: 3, endSec: 6 },
    ]);
  });

  it("handles unsorted and duplicate cuts", () => {
    expect(shotsFromCuts([4, 2, 2, 4.0004], 6)).toHaveLength(3);
  });

  it("returns one shot for a video shorter than two minimum shots", () => {
    expect(shotsFromCuts([0.3], 0.6)).toEqual([{ startSec: 0, endSec: 0.6 }]);
  });

  it("coarsens the minimum shot length rather than exceeding the shot cap", () => {
    const cuts = Array.from({ length: 20 }, (_, i) => (i + 1) * 0.6);
    const shots = shotsFromCuts(cuts, 13, MIN_SHOT_SEC, 5);
    expect(shots.length).toBeLessThanOrEqual(5);
    expect(shots[0].startSec).toBe(0);
    expect(shots.at(-1)?.endSec).toBe(13);
    for (let i = 1; i < shots.length; i += 1) expect(shots[i].startSec).toBe(shots[i - 1].endSec);
    for (const shot of shots) expect(shot.endSec - shot.startSec).toBeGreaterThanOrEqual(MIN_SHOT_SEC);
  });
});

describe("detectShots (ffmpeg)", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  beforeAll(async () => {
    ({ dir, cleanup } = await tempDir());
  });
  afterAll(async () => {
    await closeProbe();
    await cleanup();
  });

  it("finds one shot per real cut within half a second", async () => {
    const source = await makeSceneVideo(dir, "three.mp4", ["red", "blue", "green"], 2);
    const out = await tempDir();
    const made = await makeVideoDerivatives(source, out.dir, 6);
    const shots = await detectShots(made.proxy, 6);
    expect(shots).toHaveLength(3);
    expect(Math.abs(shots[0].endSec - 2)).toBeLessThan(0.5);
    expect(Math.abs(shots[1].endSec - 4)).toBeLessThan(0.5);
    await out.cleanup();
  });

  it("returns a single shot for a video with no scene change", async () => {
    const source = await makeSceneVideo(dir, "one.mp4", ["red"], 3);
    const out = await tempDir();
    const made = await makeVideoDerivatives(source, out.dir, 3);
    const shots = await detectShots(made.proxy, 3);
    expect(shots).toEqual([{ startSec: 0, endSec: 3 }]);
    await out.cleanup();
  });

  it("keeps a continuously moving clip as one shot", async () => {
    const source = await makeVideo(dir, "moving.mp4", { seconds: 3 });
    const out = await tempDir();
    const made = await makeVideoDerivatives(source, out.dir, 3);
    expect(await detectShots(made.proxy, 3)).toHaveLength(1);
    await out.cleanup();
  });
});
