import { describe, it, expect } from "vitest";
import { buildAudioClips, type AudioClip } from "./audio.js";
import type { AssembledClip } from "./assemble.js";

const holds = { base: 3.5, min: 2, max: 6 };

function makePhotoClip(id: string, audio: "keep" | "duck" | "mute", hasSpeech = false): AssembledClip {
  return {
    candidateId: `cand-${id}`,
    itemId: id,
    kind: "photo" as const,
    chapterIndex: 0,
    description: `${id} photo`,
    order: 1,
    transition: "cut" as const,
    audio,
    holdSec: holds.base,
    hasSpeech,
  };
}

function makeVideoClip(id: string, inSec: number, outSec: number, audio: "keep" | "duck" | "mute", hasSpeech = false): AssembledClip {
  return {
    candidateId: `cand-${id}`,
    itemId: id,
    kind: "video" as const,
    chapterIndex: 0,
    description: `${id} video`,
    order: 1,
    transition: "cut" as const,
    audio,
    sourceInSec: inSec,
    sourceOutSec: outSec,
    hasSpeech,
  };
}

describe("buildAudioClips — speech and ambient", () => {
  it("a keep pick with speech gets a speech clip at gain 1.0", () => {
    const clips = [makePhotoClip("photo1", "keep", true)];

    const result = buildAudioClips(clips, null, holds.base);

    expect(result.length).toBe(1);
    expect(result[0]!.kind).toBe("speech");
    expect(result[0]!.gain).toBe(1.0);
  });

  it("a duck pick gets an ambient clip at reduced gain", () => {
    const clips = [makePhotoClip("photo1", "duck")];

    const result = buildAudioClips(clips, null, holds.base);

    expect(result.length).toBe(1);
    expect(result[0]!.kind).toBe("ambient");
    expect(result[0]!.gain).toBe(0.3);
  });

  it("a mute pick emits nothing", () => {
    const clips = [makePhotoClip("photo1", "mute")];

    const result = buildAudioClips(clips, null, holds.base);

    expect(result.length).toBe(0);
  });

  it("keep without speech emits no explicit audio clip", () => {
    const clips = [makePhotoClip("photo1", "keep", false)];

    const result = buildAudioClips(clips, null, holds.base);

    expect(result.length).toBe(0);
  });

  it("audio clips are offset to their position in the film timeline", () => {
    const clips: AssembledClip[] = [
      makePhotoClip("photo1", "keep", true), // holdSec=3.5, speech at 0-3.5s
      makeVideoClip("video1", 0, 4, "duck"), // duration=4s, ambient at 3.5-7.5s
    ];

    const result = buildAudioClips(clips, null, 7.5);

    expect(result.length).toBe(2);
    expect(result[0]!.startSec).toBeCloseTo(0, 1);
    expect(result[0]!.endSec).toBeCloseTo(3.5, 1);
    expect(result[1]!.startSec).toBeCloseTo(3.5, 1);
    expect(result[1]!.endSec).toBeCloseTo(7.5, 1);
  });
});

describe("buildAudioClips — music track", () => {
  it("one music clip spans the film when soundtrackId is provided", () => {
    const clips = [makePhotoClip("photo1", "keep")];
    const duration = holds.base;

    const result = buildAudioClips(clips, "soundtrack-1", duration);

    expect(result.length).toBe(1);
    expect(result[0]!.kind).toBe("music");
    expect(result[0]!.sourceCandidateId).toBe("soundtrack-1");
    expect(result[0]!.startSec).toBe(0);
    expect(result[0]!.endSec).toBe(duration);
  });

  it("no music clip when soundtrackId is null", () => {
    const clips = [makePhotoClip("photo1", "keep")];

    const result = buildAudioClips(clips, null, holds.base);

    expect(result.length).toBe(0);
  });

  it("music gain is reduced under speech clips (ducking)", () => {
    const clips: AssembledClip[] = [
      makePhotoClip("photo1", "keep", true), // speech at 0-3.5s
      makePhotoClip("photo2", "keep"),        // no speech at 3.5-7s
    ];

    const result = buildAudioClips(clips, "soundtrack-1", holds.base * 2);

    const music = result.find(ac => ac.kind === "music");
    expect(music).toBeDefined();
    expect(music!.gain).toBeLessThan(0.6); // reduced from base 0.6
    expect(music!.gain).toBeGreaterThanOrEqual(0.2); // not muted
  });

  it("ambient clips are offset correctly alongside music", () => {
    const clips: AssembledClip[] = [
      makePhotoClip("photo1", "duck"), // ambient at 0-3.5s
      makeVideoClip("video1", 0, 4, "keep"), // no audio clip (keep without speech)
    ];

    const result = buildAudioClips(clips, "soundtrack-1", 7.5);

    expect(result.length).toBe(2);
    const ambient = result.find(ac => ac.kind === "ambient");
    const music = result.find(ac => ac.kind === "music");
    expect(ambient).toBeDefined();
    expect(music).toBeDefined();
    expect(ambient!.startSec).toBeCloseTo(0, 1);
    expect(ambient!.endSec).toBeCloseTo(3.5, 1);
  });
});

describe("buildAudioClips — edge cases", () => {
  it("empty clips returns empty array with no music even when soundtrackId is provided", () => {
    const result = buildAudioClips([], "soundtrack-1", 60);

    expect(result.length).toBe(0);
  });

  it("multiple speech clips each get their own speech track", () => {
    const clips: AssembledClip[] = [
      makePhotoClip("photo1", "keep", true),
      makeVideoClip("video1", 0, 3, "duck"),
      makePhotoClip("photo2", "keep", true),
    ];

    const result = buildAudioClips(clips, null, holds.base + 3 + holds.base);

    const speechClips = result.filter(ac => ac.kind === "speech");
    expect(speechClips.length).toBe(2);
    expect(speechClips[0]!.gain).toBe(1.0);
    expect(speechClips[1]!.gain).toBe(1.0);
  });

  it("music clip order is after all per-clip audio clips", () => {
    const clips: AssembledClip[] = [
      makePhotoClip("photo1", "keep", true), // speech
      makeVideoClip("video1", 0, 3, "duck"), // ambient
    ];

    const result = buildAudioClips(clips, "soundtrack-1", holds.base + 3);

    expect(result.length).toBe(3);
    expect(result[0]!.order).toBe(1); // speech
    expect(result[1]!.order).toBe(2); // ambient
    expect(result[2]!.kind).toBe("music"); // music is last
  });

describe("gainToDb", () => {
  it("converts the linear gain the audio layer reasons in to the decibels the contract stores", async () => {
    const { gainToDb } = await import("./audio.js");
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0.6)).toBeCloseTo(-4.44, 2);
    // The ducked music gain. `runCompose` used to discard this and write a flat
    // -6dB from the clip's role, so the music never ducked under speech.
    expect(gainToDb(0.3)).toBeCloseTo(-10.46, 2);
    expect(gainToDb(0)).toBe(-60);
  });
});
});
