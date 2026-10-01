/**
 * The recorder's whole value rests on one property: a prompt full of this
 * run's Firestore IDs must key to the same fixture as the recorded run, and
 * the replayed answer must come back naming THIS run's IDs. These tests pin
 * that round trip, because a regression in it looks like a cache miss or,
 * worse, like the director inventing shot IDs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
    vi.stubEnv("GEMINI_FIXTURES", dir);
    vi.stubEnv("MOCK_GEMINI", "record");
    vi.resetModules();
    recorder = await import("./recorder.js");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
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

  it("never overwrites an existing fixture during recording", async () => {
    const first = recorder.recordingGenerate(vi.fn(async () => ({ text: '{"caption":"original"}', usageMetadata: {} })) as never);
    const second = recorder.recordingGenerate(vi.fn(async () => ({ text: '{"caption":"replacement"}', usageMetadata: {} })) as never);

    await first(photo("AAAA") as never);
    const [filename] = readdirSync(dir).filter((name) => name.endsWith(".json"));
    const before = readFileSync(path.join(dir, filename!), "utf8");
    const result = await second(photo("AAAA") as never);

    expect((result as { text: string }).text).toBe('{"caption":"original"}');
    expect(readFileSync(path.join(dir, filename!), "utf8")).toBe(before);
  });

  it("still calls the model for a photo it has not seen", async () => {
    const real = vi.fn(async () => ({ text: '{"caption":"a cat"}', usageMetadata: {} }));
    const generate = recorder.recordingGenerate(real as never);

    await generate(photo("AAAA") as never);
    await generate(photo("BBBB") as never);

    expect(real).toHaveBeenCalledTimes(2);
  });

  it("labels director chat interpretation recordings distinctly", async () => {
    const real = vi.fn(async () => ({ text: '{"change":{"kind":"unclear"}}', usageMetadata: {} }));
    await recorder.recordingGenerate(real as never)({
      model: "gemini-3.1-flash-lite",
      contents: [{ text: "Interpret the user's typed message only for the current director chat step." }],
    } as never);
    expect(readdirSync(dir).some((name) => name.startsWith("interpret-") && name.endsWith(".json"))).toBe(true);
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

describe("recording image embeddings", () => {
  let dir: string;
  let recorder: typeof import("./recorder.js");

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "gemini-image-embeddings-"));
    vi.stubEnv("GEMINI_FIXTURES", dir);
    vi.stubEnv("MOCK_GEMINI", "record");
    vi.resetModules();
    recorder = await import("./recorder.js");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("reuses embeddings for identical image bytes and distinguishes different bytes", async () => {
    const recordingImageEmbed = (recorder as typeof recorder & { recordingImageEmbed?: (real: (input: { model: string; jpeg: Buffer }) => Promise<number[]>) => (input: { model: string; jpeg: Buffer }) => Promise<number[]> }).recordingImageEmbed;
    expect(recordingImageEmbed).toBeTypeOf("function");
    if (!recordingImageEmbed) return;
    const real = vi.fn(async ({ jpeg }: { model: string; jpeg: Buffer }) => [jpeg[0]!, 1]);
    const embed = recordingImageEmbed(real);
    const same = Buffer.from([7, 8, 9]);

    await expect(embed({ model: "gemini-embedding-2", jpeg: same })).resolves.toEqual([7, 1]);
    await expect(embed({ model: "gemini-embedding-2", jpeg: Buffer.from([7, 8, 9]) })).resolves.toEqual([7, 1]);
    await expect(embed({ model: "gemini-embedding-2", jpeg: Buffer.from([7, 8, 0]) })).resolves.toEqual([7, 1]);

    expect(real).toHaveBeenCalledTimes(2);
  });
});

describe("exact replay across project ids", () => {
  it("replays an existing trip1-v2 plan with fresh shot ids", async () => {
    vi.resetModules();
    const recorder = await import("./recorder.js");
    const fixture = JSON.parse(readFileSync(new URL("../../fixtures/gemini/direct-1dfaf625c84f.json", import.meta.url), "utf8")) as { key: string; request: string };
    const ids = (prefix: string) => fixture.request.replace(/«(\d+)»/g, (_whole, index: string) => `${prefix}GeneratedShot${index.padStart(3, "0")}Identifier`);
    const first = JSON.parse(ids("First"));
    const second = JSON.parse(ids("Second"));
    expect(recorder.normaliseRequest(first).key).toBe(fixture.key);
    expect(recorder.normaliseRequest(second).key).toBe(fixture.key);
    const replay = recorder.replayingExactGenerate();
    const a = JSON.stringify(await replay(first));
    const b = JSON.stringify(await replay(second));
    expect(a).toContain("FirstGeneratedShot");
    expect(b).toContain("SecondGeneratedShot");
    expect(b).not.toContain("FirstGeneratedShot");
  });
  it("remaps a recorded plan to the current project's shot ids and reports a real miss", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gemini-demo-"));
    vi.stubEnv("GEMINI_FIXTURES", dir);
    vi.resetModules();
    try {
      const recorder = await import("./recorder.js");
      const oldShot = "PzKsKGD8UoLogudUhFh0_0000";
      const newShot = "aB3xQ91mZpLkRt77WsEy_0000";
      await recorder.recordingGenerate(async () => ({ text: JSON.stringify({ moments: [{ shotId: oldShot }] }), usageMetadata: {} }))(requestFor(oldShot));
      const replay = recorder.replayingExactGenerate();
      expect((await replay(requestFor(newShot)) as { text: string }).text).toContain(newShot);
      await expect(replay({ ...requestFor(newShot), contents: "a different story" })).rejects.toBeInstanceOf(recorder.FixtureMissing);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });
});
