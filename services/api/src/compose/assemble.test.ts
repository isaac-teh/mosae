import { describe, it, expect } from "vitest";
import { assemble, isEmptyResult, type DropReason } from "./assemble.js";
import { ComposeResponseSchema, type ComposePicks } from "./assemble.js";

const holds = { base: 3.5, min: 2, max: 6 };

function makeCandidate(kind: "photo" | "video", extra?: any) {
  return {
    candidateId: `cand-${kind}-1`,
    itemId: `item-${kind}`,
    kind,
    chapterIndex: 0,
    description: `${kind} candidate`,
    ...extra,
  };
}

function makeCandidateWithId(candidateId: string, extra?: any) {
  return {
    candidateId,
    itemId: extra?.itemId ?? `item-${candidateId}`,
    kind: extra?.kind ?? "photo",
    chapterIndex: 0,
    description: `${extra?.kind ?? "photo"} candidate`,
    inSec: extra?.inSec,
    outSec: extra?.outSec,
    hasSpeech: extra?.hasSpeech,
  };
}

function makePicks(overrides?: Partial<ComposePicks>): ComposePicks {
  return {
    clips: [
      {
        candidateId: "cand-photo-1",
        transition: "cut" as const,
        audio: "keep" as const,
        holdSec: 3.5,
      },
    ],
    musicCues: [],
    ...overrides,
  };
}

describe("assemble — drop rules", () => {
  it("drops unknown candidateId", () => {
    const candidates = new Map<string, any>();
    const picks = makePicks({ clips: [{ candidateId: "unknown-id", transition: "cut" as const, audio: "keep" as const }] });

    const result = assemble(picks, candidates, holds);

    expect(result.clips.length).toBe(0);
    expect(result.dropped.length).toBe(1);
    expect(result.dropped[0]!.reason).toContain("unknown candidate");
  });

  it("drops the same candidate twice", () => {
    const candidates = new Map([["cand-photo-1", makeCandidate("photo")]]);
    const picks = makePicks({ clips: [
      { candidateId: "cand-photo-1", transition: "cut" as const, audio: "keep" as const },
      { candidateId: "cand-photo-1", transition: "crossfade" as const, audio: "duck" as const },
    ]});

    const result = assemble(picks, candidates, holds);

    expect(result.clips.length).toBe(1);
    expect(result.dropped.length).toBe(1);
    expect(result.dropped[0]!.reason).toContain("repeat of clip");
  });

  it("drops more than MAX_PER_ITEM clips from one asset", () => {
    const candidates = new Map([
      ["cand-1", makeCandidateWithId("cand-1", { kind: "video" as const, itemId: "item-video" })],
      ["cand-2", makeCandidateWithId("cand-2", { kind: "video" as const, itemId: "item-video" })],
      ["cand-3", makeCandidateWithId("cand-3", { kind: "video" as const, itemId: "item-video" })],
      ["cand-4", makeCandidateWithId("cand-4", { kind: "video" as const, itemId: "item-video" })], // 4th clip from same item
    ]);
    const picks = makePicks({ clips: [
      { candidateId: "cand-1", transition: "cut" as const, audio: "keep" as const },
      { candidateId: "cand-2", transition: "cut" as const, audio: "keep" as const },
      { candidateId: "cand-3", transition: "cut" as const, audio: "keep" as const },
      { candidateId: "cand-4", transition: "cut" as const, audio: "keep" as const },
    ]});

    const result = assemble(picks, candidates, holds);

    expect(result.clips.length).toBe(3);
    expect(result.dropped.length).toBe(1);
    expect(result.dropped[0]!.reason).toContain("more than 3 clips");
  });

  it("drops the same still twice in a row", () => {
    const candidates = new Map([
      ["cand-still-1", makeCandidateWithId("cand-still-1", { kind: "photo" as const, itemId: "item-photo" })],
      ["cand-still-2", makeCandidateWithId("cand-still-2", { kind: "photo" as const, itemId: "item-photo" })],
    ]);
    const picks = { clips: [
      { candidateId: "cand-still-1", transition: "cut" as const, audio: "keep" as const },
      { candidateId: "cand-still-2", transition: "crossfade" as const, audio: "duck" as const },
    ], musicCues: [] };

    const result = assemble(picks, candidates, holds);

    expect(result.clips.length).toBe(1);
    expect(result.dropped.length).toBe(1);
    expect(result.dropped[0]!.reason).toContain("same still twice in a row");
  });

  it("allows the same still if separated by video", () => {
    const candidates = new Map([
      ["cand-still-1", makeCandidateWithId("cand-still-1", { kind: "photo" as const, itemId: "item-photo" })],
      ["cand-video-1", makeCandidateWithId("cand-video-1", { kind: "video" as const, itemId: "item-video" })],
      ["cand-still-2", makeCandidateWithId("cand-still-2", { kind: "photo" as const, itemId: "item-photo" })],
    ]);
    const picks = { clips: [
      { candidateId: "cand-still-1", transition: "cut" as const, audio: "keep" as const },
      { candidateId: "cand-video-1", transition: "crossfade" as const, audio: "duck" as const },
      { candidateId: "cand-still-2", transition: "dip" as const, audio: "mute" as const },
    ], musicCues: [] };

    const result = assemble(picks, candidates, holds);

    expect(result.clips.length).toBe(3);
    expect(result.dropped.length).toBe(0);
  });
});

describe("assemble — photo holdSec", () => {
  it("clamps holdSec to holds range when provided", () => {
    const candidates = new Map([["cand-photo-1", makeCandidate("photo")]]);
    const picks = makePicks({ clips: [{ candidateId: "cand-photo-1", transition: "cut" as const, audio: "keep" as const, holdSec: 10 }] });

    const result = assemble(picks, candidates, holds);

    expect(result.clips[0]!.holdSec).toBe(6); // clamped to max
  });

  it("uses base when holdSec not provided", () => {
    const candidates = new Map([["cand-photo-1", makeCandidate("photo")]]);
    const picks = makePicks({ clips: [{ candidateId: "cand-photo-1", transition: "cut" as const, audio: "keep" as const }] });

    const result = assemble(picks, candidates, holds);

    expect(result.clips[0]!.holdSec).toBe(3.5); // base value
  });

  it("clamps holdSec to min when too low", () => {
    const candidates = new Map([["cand-photo-1", makeCandidate("photo")]]);
    const picks = makePicks({ clips: [{ candidateId: "cand-photo-1", transition: "cut" as const, audio: "keep" as const, holdSec: 0.5 }] });

    const result = assemble(picks, candidates, holds);

    expect(result.clips[0]!.holdSec).toBe(2); // clamped to min
  });
});

describe("assemble — video source range", () => {
  it("carries inSec and outSec from candidate for video clips", () => {
    const candidates = new Map([["cand-video-1", makeCandidate("video", { inSec: 2, outSec: 5 })]]);
    const picks = makePicks({ clips: [{ candidateId: "cand-video-1", transition: "cut" as const, audio: "keep" as const }] });

    const result = assemble(picks, candidates, holds);

    expect(result.clips[0]!.sourceInSec).toBe(2);
    expect(result.clips[0]!.sourceOutSec).toBe(5);
  });
});

describe("assemble — empty result", () => {
  it("returns failure when every pick is dropped", () => {
    const candidates = new Map<string, any>();
    const picks = makePicks({ clips: [
      { candidateId: "unknown-1", transition: "cut" as const, audio: "keep" as const },
      { candidateId: "unknown-2", transition: "crossfade" as const, audio: "duck" as const },
    ]});

    const result = assemble(picks, candidates, holds);

    expect(result.clips.length).toBe(0);
    expect(isEmptyResult(result.dropped, picks.clips.length)).toBe(true);
  });

  it("does not fail when no picks at all", () => {
    const candidates = new Map<string, any>();
    const picks = makePicks({ clips: [] });

    const result = assemble(picks, candidates, holds);

    expect(result.clips.length).toBe(0);
    expect(isEmptyResult(result.dropped, 0)).toBe(false);
  });
});

describe("assemble — valid response", () => {
  it("produces AssembledClips in the model's order with correct fields", () => {
    const candidates = new Map([
      ["cand-photo-1", makeCandidate("photo")],
      ["cand-video-1", makeCandidate("video", { inSec: 1, outSec: 4 })],
    ]);
    const picks = makePicks({ clips: [
      { candidateId: "cand-photo-1", transition: "cut" as const, audio: "keep" as const },
      { candidateId: "cand-video-1", transition: "crossfade" as const, audio: "duck" as const },
    ]});

    const result = assemble(picks, candidates, holds);

    expect(result.clips.length).toBe(2);
    expect(result.clips[0]!.order).toBe(1);
    expect(result.clips[1]!.order).toBe(2);
  });
});
