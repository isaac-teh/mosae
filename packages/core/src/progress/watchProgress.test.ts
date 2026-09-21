import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawProgress } from "./progress";
import { watchProjectProgress } from "./watchProgress";

const processing = (ingested: number): RawProgress => ({ status: "processing", ingested, failed: 0 });
const ready: RawProgress = { status: "ready", ingested: 3, failed: 0 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("watchProjectProgress", () => {
  it("emits after each poll and stops once the project has finished", async () => {
    const read = vi.fn().mockResolvedValueOnce(processing(1)).mockResolvedValueOnce(processing(2)).mockResolvedValue(ready);
    const onChange = vi.fn();
    watchProjectProgress("p1", 3, { onChange }, { read }, 1000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange.mock.calls.map(([p]) => p.done)).toEqual([1, 2, 3]);
    const readsWhenFinished = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read.mock.calls.length).toBe(readsWhenFinished);
  });

  it("stops polling when the returned function is called", async () => {
    const read = vi.fn().mockResolvedValue(processing(1));
    const stop = watchProjectProgress("p1", 3, { onChange: vi.fn() }, { read }, 1000);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const before = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(read.mock.calls.length).toBe(before);
  });

  it("gives up after a first read that fails, reporting the error once", async () => {
    const read = vi.fn().mockRejectedValue(new Error("permission denied"));
    const onError = vi.fn();
    watchProjectProgress("p1", 3, { onChange: vi.fn(), onError }, { read }, 1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("tolerates a transient failure after a successful read and keeps polling", async () => {
    const read = vi.fn().mockResolvedValueOnce(processing(1)).mockRejectedValueOnce(new Error("blip")).mockResolvedValue(ready);
    const onChange = vi.fn();
    const onError = vi.fn();
    watchProjectProgress("p1", 3, { onChange, onError }, { read }, 1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true }));
    expect(onError).not.toHaveBeenCalled();
  });

  it("gives up after three consecutive failures following a success", async () => {
    const read = vi.fn().mockResolvedValueOnce(processing(1)).mockRejectedValue(new Error("down"));
    const onError = vi.fn();
    watchProjectProgress("p1", 3, { onChange: vi.fn(), onError }, { read }, 1000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(4);
  });
});
