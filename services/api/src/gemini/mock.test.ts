/**
 * The recorder's whole value rests on one property: a prompt full of this
 * run's Firestore IDs must key to the same fixture as the recorded run, and
 * the replayed answer must come back naming THIS run's IDs. These tests pin
 * that round trip, because a regression in it looks like a cache miss or,
 * worse, like the director inventing shot IDs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normaliseRequest } from "./recorder.js";

const requestFor = (shotId: string) => ({
  model: "gemini-3.1-flash-lite",
  contents: `Candidates: [{"id":"${shotId}#still@c0","itemId":"${shotId}"}]`,
  config: { responseMimeType: "application/json" },
});

describe("recorder normalisation", () => {
  it("keys two runs with different IDs to the same fixture", () => {
    const first = normaliseRequest(requestFor("PzKsKGD8UoLogudUhFh0"));
    const second = normaliseRequest(requestFor("aB3xQ91mZpLkRt77WsEy"));
    expect(second.key).toBe(first.key);
  });

  it("keeps the structural suffix and masks only the generated part", () => {
    const { masked } = normaliseRequest(requestFor("PzKsKGD8UoLogudUhFh0"));
    expect(masked).toContain("#still@c0");
    expect(masked).not.toContain("PzKsKGD8UoLogudUhFh0");
  });

  it("distinguishes prompts that differ beyond their IDs", () => {
    const a = normaliseRequest(requestFor("PzKsKGD8UoLogudUhFh0"));
    const b = normaliseRequest({ ...requestFor("PzKsKGD8UoLogudUhFh0"), model: "gemini-3.5-flash-lite" });
    expect(b.key).not.toBe(a.key);
  });

  it("collapses image bytes to a digest so the key stays small and stable", () => {
    const withImage = (data: string) =>
      normaliseRequest({ contents: [{ text: "Analyze this photo" }, { inlineData: { mimeType: "image/jpeg", data } }] });
    expect(withImage("AAAA").masked).toContain("sha256:");
    expect(withImage("AAAA").key).toBe(withImage("AAAA").key);
    expect(withImage("AAAA").key).not.toBe(withImage("BBBB").key);
  });

  it("ignores the per-call abort signal", () => {
    const base = { model: "m", contents: "hello world" };
    const bare = normaliseRequest(base);
    const signalled = normaliseRequest({ ...base, config: { abortSignal: new AbortController().signal } });
    // The signal drops out; only the empty config object remains.
    expect(signalled.masked).not.toContain("abortSignal");
    expect(bare.idMap.ids).toEqual([]);
  });

  it("records each distinct ID once, in order of first appearance", () => {
    const { idMap } = normaliseRequest({
      contents: `first PzKsKGD8UoLogudUhFh0 then aB3xQ91mZpLkRt77WsEy then PzKsKGD8UoLogudUhFh0 again`,
    });
    expect(idMap.ids).toEqual(["PzKsKGD8UoLogudUhFh0", "aB3xQ91mZpLkRt77WsEy"]);
  });

  it("leaves ordinary long words alone", () => {
    const { masked, idMap } = normaliseRequest({ contents: "an internationalisation consideration" });
    expect(masked).toContain("internationalisation");
    expect(idMap.ids).toEqual([]);
  });
});

/**
 * Recording is resumable: a second run must not re-buy what the first already
 * captured. These load the recorder against a throwaway fixture directory, so
 * the assertions are about call counts rather than about the committed set.
 */
describe("recording skips what it already has", () => {
  let dir: string;
  let recorder: typeof import("./recorder.js");

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "gemini-fixtures-"));
    process.env.GEMINI_FIXTURES = dir;
    process.env.MOCK_GEMINI = "record";
    vi.resetModules();
    recorder = await import("./recorder.js");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.GEMINI_FIXTURES;
    delete process.env.MOCK_GEMINI;
  });

  const photo = (data: string) => ({
    model: "gemini-3.1-flash-lite",
    contents: [{ text: "Analyze this photo" }, { inlineData: { mimeType: "image/jpeg", data } }],
  });

  it("calls the model once for a photo, then serves the second run from disk", async () => {
    const real = vi.fn(async () => ({ text: '{"caption":"a cat"}', usageMetadata: {} }));
    const generate = recorder.recordingGenerate(real as never);

    const first = await generate(photo("AAAA") as never);
    const second = await generate(photo("AAAA") as never);

    expect(real).toHaveBeenCalledTimes(1);
    expect((second as { text: string }).text).toBe((first as { text: string }).text);
  });

  it("still calls the model for a photo it has not seen", async () => {
    const real = vi.fn(async () => ({ text: '{"caption":"a cat"}', usageMetadata: {} }));
    const generate = recorder.recordingGenerate(real as never);

    await generate(photo("AAAA") as never);
    await generate(photo("BBBB") as never);

    expect(real).toHaveBeenCalledTimes(2);
  });

  it("embeds only the texts it lacks, and keeps every vector in position", async () => {
    let call = 0;
    const real = vi.fn(async ({ contents }: { contents: string[] }) => {
      call += 1;
      return contents.map((text) => [text.length, call]);
    });
    const embed = recorder.recordingEmbed(real as never);
    const input = { model: "gemini-embedding-2", taskType: "RETRIEVAL_DOCUMENT" };

    await embed({ ...input, contents: ["alpha"] } as never);
    // "alpha" is cached; only "bb" and "cccc" should reach the model.
    const second = await embed({ ...input, contents: ["bb", "alpha", "cccc"] } as never);

    expect(real).toHaveBeenCalledTimes(2);
    expect((real.mock.calls[1] as unknown as [{ contents: string[] }])[0].contents).toEqual(["bb", "cccc"]);
    // Position 1 is the cached "alpha" vector from call 1, not a fresh one.
    expect(second).toEqual([[2, 2], [5, 1], [4, 2]]);
  });

  it("does not call the model at all when every text is cached", async () => {
    const real = vi.fn(async ({ contents }: { contents: string[] }) => contents.map(() => [0.5]));
    const embed = recorder.recordingEmbed(real as never);
    const input = { model: "gemini-embedding-2", taskType: "RETRIEVAL_DOCUMENT" };

    await embed({ ...input, contents: ["one", "two"] } as never);
    await embed({ ...input, contents: ["two", "one"] } as never);

    expect(real).toHaveBeenCalledTimes(1);
  });
});

