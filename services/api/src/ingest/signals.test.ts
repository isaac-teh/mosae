import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeProbe } from "./probe.js";
import { makeVideo, tempDir } from "./testMedia.js";
import { makeVideoDerivatives } from "./proxies.js";
import { extractShotSignals, MAX_SIGNAL_SAMPLES } from "./signals.js";

describe("extractShotSignals (ffmpeg)", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  beforeAll(async () => { ({ dir, cleanup } = await tempDir()); });
  afterAll(async () => { await closeProbe(); await cleanup(); });

  it("samples motion, blur and audio from a generated proxy and stays within bounds", async () => {
    const source = await makeVideo(dir, "signals.mp4", { seconds: 2 });
    const out = await tempDir();
    try {
      const proxy = await makeVideoDerivatives(source, out.dir, 2);
      const signals = await extractShotSignals(proxy.proxy, 0, 2);
      expect(signals.stepSec).toBe(0.25);
      expect(signals.shake.length).toBeGreaterThan(0);
      expect(signals.shake.length).toBeLessThanOrEqual(MAX_SIGNAL_SAMPLES);
      expect(signals.blur).toHaveLength(signals.shake.length);
      expect(signals.loud).toHaveLength(signals.shake.length);
      for (const values of [signals.shake, signals.blur, signals.loud]) for (const value of values) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        expect(value * 100).toBeCloseTo(Math.round(value * 100));
      }
      expect(signals.loud.some((value) => value > 0)).toBe(true);
    } finally { await out.cleanup(); }
  });
});
