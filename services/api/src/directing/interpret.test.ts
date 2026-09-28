import { describe, expect, it, vi } from "vitest";
import { interpret, type InterpretRequest } from "./interpret.js";

const request = (step: InterpretRequest["step"], text: string): InterpretRequest => ({ step, text, context: {} });
const generate = (value: unknown) => vi.fn().mockResolvedValue(value);

describe("interpret", () => {
  it("maps tone text to direction", async () => {
    const result = await interpret(request("direction", "more upbeat, and shorter"), {
      generate: generate({ change: { kind: "direction", pace: "lively", lengthSec: 60 } }), searchShots: vi.fn(),
    });
    expect(result.change).toEqual({ kind: "direction", pace: "lively", lengthSec: 60 });
    expect(result.reply).toBeTruthy();
  });
  it("keeps off-step text as a note", async () => {
    const result = await interpret(request("occasion", "remember to thank the hosts"), {
      generate: generate({ change: { kind: "note", note: "Thank the hosts" } }), searchShots: vi.fn(),
    });
    expect(result.change).toEqual({ kind: "note", note: "Thank the hosts" });
  });
  it("turns a change kind for another step into the user's note", async () => {
    const result = await interpret(request("occasion", "make it more upbeat"), {
      generate: generate({ change: { kind: "direction", pace: "lively" }, reply: "I'll make it more upbeat." }), searchShots: vi.fn(),
    });
    expect(result).toEqual({ reply: "I'll keep that in mind.", change: { kind: "note", note: "make it more upbeat" } });
  });
  it("keeps off-step text as a note even when model confidence is low", async () => {
    const result = await interpret(request("occasion", "make it more upbeat"), {
      generate: generate({ confidence: 0.2, change: { kind: "direction", pace: "lively" } }), searchShots: vi.fn(),
    });
    expect(result).toEqual({ reply: "I'll keep that in mind.", change: { kind: "note", note: "make it more upbeat" } });
  });
  it("returns the fallback when generation fails", async () => {
    const result = await interpret(request("people", "the girl in pink is Mia"), {
      generate: vi.fn().mockRejectedValue(new Error("offline")), searchShots: vi.fn(),
    });
    expect(result).toEqual({ reply: "I didn't catch that. Pick one below, or say it another way.", change: { kind: "unclear" } });
  });
  it("searches moments using the model query", async () => {
    const searchShots = vi.fn().mockResolvedValue(["s1", "s2"]);
    const result = await interpret(request("moments", "the snow monkeys must be in"), {
      generate: generate({ change: { kind: "moments", query: "snow monkeys" } }), searchShots,
    });
    expect(searchShots).toHaveBeenCalledWith("snow monkeys");
    expect(result.change).toEqual({ kind: "moments", mustIncludeShotIds: ["s1", "s2"] });
  });
});
