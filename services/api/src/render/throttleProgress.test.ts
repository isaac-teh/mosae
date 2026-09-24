import { describe, it, expect, vi } from "vitest";
import { throttleProgress } from "./throttleProgress.js";

describe("throttleProgress", () => {
  it("writes a handful of times for a 900-frame render, not 900", async () => {
    // A five-minute film is 9,000 frames and Remotion reports every one. The
    // count is what matters here, not the timing, so the clock is synthetic.
    const write = vi.fn().mockResolvedValue(undefined);
    let clock = 0;
    const throttle = throttleProgress(write, { now: () => clock });

    for (let frame = 1; frame <= 900; frame++) {
      clock += 10; // 10ms a frame: nine seconds of render
      await throttle.report(frame / 900);
    }

    // One write a second, and the last one is the 1.0 the screen waits for.
    expect(write).toHaveBeenCalledTimes(9);
    expect(write.mock.calls.at(-1)).toEqual([1]);
  });

  it("holds back when a second has passed but the render has barely moved", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    let clock = 0;
    const throttle = throttleProgress(write, { now: () => clock });

    for (let i = 0; i < 20; i++) {
      clock += 5_000; // a hundred seconds
      await throttle.report(i * 0.001); // under 5% moved throughout
    }

    expect(write).not.toHaveBeenCalled();
  });

  it("holds back when the render has moved but no second has passed", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    let clock = 0;
    const throttle = throttleProgress(write, { now: () => clock });

    clock += 10;
    await throttle.report(0.4);
    clock += 10;
    await throttle.report(0.8);

    expect(write).not.toHaveBeenCalled();
  });

  it("always lets the finished render through", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const throttle = throttleProgress(write, { now: () => 0 });

    await throttle.report(1);

    expect(write).toHaveBeenCalledWith(1);
    expect(throttle.writes).toBe(1);
  });

  it("clamps what the renderer reports", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const throttle = throttleProgress(write, { now: () => 0 });

    await throttle.report(1.4);

    expect(write).toHaveBeenCalledWith(1);
  });
});
