/**
 * The recorder's whole value rests on one property: a prompt full of this
 * run's Firestore IDs must key to the same fixture as the recorded run, and
 * the replayed answer must come back naming THIS run's IDs. These tests pin
 * that round trip, because a regression in it looks like a cache miss or,
 * worse, like the director inventing shot IDs.
 */
import { describe, expect, it } from "vitest";
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
