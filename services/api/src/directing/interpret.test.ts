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
  it("passes explicitly mentioned people through an occasion interpretation", async () => {
    const result = await interpret(request("occasion", "My son children day celebration"), {
      generate: generate({ change: { kind: "occasion", storyText: "Children's Day celebration", mentionedPeople: ["son"] } }), searchShots: vi.fn(),
    });
    expect(result.change).toEqual({ kind: "occasion", storyText: "Children's Day celebration", mentionedPeople: ["son"] });
  });
  it("asks for confirmation because interpretation does not apply changes", async () => {
    const generate = vi.fn().mockResolvedValue({ change: { kind: "direction", pace: "lively", lengthSec: 60 } });
    await interpret(request("direction", "more upbeat, and shorter"), { generate, searchShots: vi.fn() });
    const prompt = (generate.mock.calls[0]![0] as { contents: { text: string }[] }).contents[0]!.text;
    expect(prompt).toContain("Nothing has been applied yet");
    expect(prompt).toContain("confirmation question");
    expect(prompt).toContain("Make it lively and about a minute?");
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
  it("interprets a missed-name list and asks for names when a plural relation is vague", async () => {
    const missed = await interpret({ ...request("people", "Grandpa and Grandma"), context: { peopleStage: "missed" } }, {
      generate: generate({ change: { kind: "person", intent: "missed", names: ["Grandpa", "Grandma"], needsClarification: false } }), searchShots: vi.fn(),
    });
    expect(missed.change).toMatchObject({ intent: "missed", names: ["Grandpa", "Grandma"] });
    const clarify = await interpret({ ...request("people", "my two cousins"), context: { peopleStage: "missed" } }, {
      generate: generate({ change: { kind: "person", intent: "missed", names: [], needsClarification: true, clarifyingQuestion: "What are their names?" } }), searchShots: vi.fn(),
    });
    expect(clarify.change).toMatchObject({ needsClarification: true, clarifyingQuestion: "Is that one person? What's their name?" });
  });
  it.each([
    ["Grandpa and Grandma", ["Grandpa", "Grandma"]],
    ["Mum, Dad and Uncle", ["Mum", "Dad", "Uncle"]],
    ["my son", ["Son"]],
  ])("accepts identified role words in missed names: %s", async (text, names) => {
    const gen = vi.fn();
    const result = await interpret({ ...request("people", text), context: { peopleStage: "missed" } }, { generate: gen, searchShots: vi.fn() });
    expect(result.change).toMatchObject({ kind: "person", intent: "missed", names, needsClarification: false });
    expect(gen).not.toHaveBeenCalled();
  });
  it.each(["my two cousins", "some friends", "three kids"])("clarifies counts without identities: %s", async (text) => {
    const gen = vi.fn();
    const result = await interpret({ ...request("people", text), context: { peopleStage: "missed" } }, { generate: gen, searchShots: vi.fn() });
    expect(result.change).toMatchObject({ kind: "person", intent: "missed", needsClarification: true, clarifyingQuestion: "Is that one person? What's their name?" });
    expect(gen).not.toHaveBeenCalled();
  });
  it("extracts a name or a normalized family role and classifies change requests", async () => {
    const single = await interpret(request("people", "Mia"), { generate: generate({ change: { kind: "person", intent: "assign", names: ["Mia"], name: "Mia", role: "other", needsClarification: false } }), searchShots: vi.fn() });
    expect(single.change).toMatchObject({ intent: "assign", name: "Mia", names: ["Mia"], needsClarification: false });
    const role = await interpret(request("people", "My daughter"), { generate: generate({ change: { kind: "person", intent: "assign", names: ["Daughter"], name: "Daughter", role: "child", needsClarification: false } }), searchShots: vi.fn() });
    expect(role.change).toMatchObject({ name: "Daughter", role: "child" });
    const change = await interpret({ ...request("people", "Wife is wrong"), context: { peopleStage: "summary" } }, { generate: generate({ change: { kind: "person", intent: "change", names: ["Wife"], name: "Wife", role: "other", needsClarification: false } }), searchShots: vi.fn() });
    expect(change.change).toMatchObject({ intent: "change", names: ["Wife"] });
  });
  it.each([
    ["My daughter", "Daughter", "child"],
    ["my wife", "Wife", "parent"],
    ["That's me", "Me", "other"],
    ["it's me", "Me", "other"],
    ["Grandpa", "Grandpa", "other"],
  ])("fast-paths clear role answer %s", async (text, name, role) => {
    const gen = vi.fn();
    const result = await interpret({ ...request("people", text), context: { peopleStage: "identify" } }, { generate: gen, searchShots: vi.fn() });
    expect(result.change).toMatchObject({ kind: "person", intent: "assign", name, names: [name], role, needsClarification: false });
    expect(gen).not.toHaveBeenCalled();
  });
  it.each(["Zx", "JJ", "Ah Ma", "a", "Mei Ling", "bb"])("fast-paths short names verbatim: %s", async (text) => {
    const gen = vi.fn();
    const name = text === text.toLocaleLowerCase() ? `${text[0]!.toLocaleUpperCase()}${text.slice(1)}` : text;
    const result = await interpret({ ...request("people", text), context: { peopleStage: "identify" } }, { generate: gen, searchShots: vi.fn() });
    expect(result.change).toMatchObject({ kind: "person", intent: "assign", name, names: [name], needsClarification: false });
    expect(gen).not.toHaveBeenCalled();
  });
  it("keeps ambiguous person answers eligible for clarification and tells the model roles are complete answers", async () => {
    const gen = generate({ change: { kind: "person", intent: "unclear", names: [], name: "", role: "other", needsClarification: true, clarifyingQuestion: "Who do you mean?" } });
    await interpret({ ...request("people", "two kids"), context: { peopleStage: "identify" } }, { generate: gen, searchShots: vi.fn() });
    const prompt = (gen.mock.calls[0]![0] as { contents: { text: string }[] }).contents[0]!.text;
    expect(prompt).toContain("relationship or role by itself is a complete answer");
    expect(prompt).toContain("Ask for clarification only when the answer is genuinely ambiguous");
  });
  it("fast-paths exact Proceed and everyone confirmations without Gemini", async () => {
    const gen = vi.fn();
    const proceed = await interpret({ ...request("people", "Proceed"), context: { peopleStage: "tagged" } }, { generate: gen, searchShots: vi.fn() });
    expect(proceed.change).toMatchObject({ intent: "proceed" });
    expect(gen).not.toHaveBeenCalled();
    const everyone = await interpret(request("people", "That's everyone"), { generate: gen, searchShots: vi.fn() });
    expect(everyone.change).toMatchObject({ intent: "confirm" });
    expect(gen).not.toHaveBeenCalled();
    const summary = await interpret({ ...request("people", "Looks right"), context: { peopleStage: "summary" } }, { generate: gen, searchShots: vi.fn() });
    expect(summary.change).toMatchObject({ intent: "confirm" });
    expect(gen).not.toHaveBeenCalled();
  });
  it("accepts short missed names while clarifying a vague plural", async () => {
    const gen = vi.fn();
    const names = await interpret({ ...request("people", "Zx and Bo"), context: { peopleStage: "missed" } }, { generate: gen, searchShots: vi.fn() });
    expect(names.change).toMatchObject({ intent: "missed", names: ["Zx", "Bo"], needsClarification: false });
    const vague = await interpret({ ...request("people", "my two kids"), context: { peopleStage: "missed" } }, { generate: gen, searchShots: vi.fn() });
    expect(vague.change).toMatchObject({ needsClarification: true, clarifyingQuestion: "Is that one person? What's their name?" });
    expect(gen).not.toHaveBeenCalled();
  });
});
