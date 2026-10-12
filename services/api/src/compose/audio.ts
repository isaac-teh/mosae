import type { AssembledClip } from "./assemble.js";
import { fadeOutSec } from "./directingRules.js";
import { loadLibrary } from "../music/library.js";

/** Audio clip emitted by the audio layer. */
export interface AudioClip {
  /** Clip order (1-based). */
  order: number;
  /** Source candidateId this audio belongs to. */
  sourceCandidateId: string;
  /** Start time in the film timeline (seconds). */
  startSec: number;
  /** End time in the film timeline (seconds). */
  endSec: number;
  /** Audio type: speech, ambient, or music. */
  kind: "speech" | "ambient" | "music";
  /** Gain level (0 = mute, 1 = full). */
  gain: number;
  sourceInSec?: number;
  sourceOutSec?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
}

/**
 * The contract stores gain in decibels; the audio layer reasons in a linear
 * 0–1 multiplier. One conversion, rounded so the same plan always serializes to
 * the same bytes.
 */
export function gainToDb(gain: number): number {
  if (gain <= 0) return -60;
  const db = 20 * Math.log10(gain);
  return Number(Math.min(12, Math.max(-60, db)).toFixed(2));
}

/** Duration of a single clip in the film timeline. */
function clipDuration(clip: AssembledClip): number {
  if (clip.holdSec != null) return clip.holdSec;
  if (clip.sourceInSec != null && clip.sourceOutSec != null) {
    return clip.sourceOutSec - clip.sourceInSec;
  }
  return 0;
}

/**
 * Build audio clips from assembled plan.
 *
 * Rules:
 * - A pick with `keep` that carries speech gets a `speech` audio clip at 0dB (gain=1).
 * - A pick with `duck` gets an `ambient` clip at reduced gain (gain=0.3).
 * - A pick with `mute` emits nothing.
 * - One `music` clip spans the entire film with fades at both ends.
 *   Gain is reduced under any clip carrying speech.
 * - When `soundtrackId` is null, emit no music clip at all and return a valid plan.
 */
export function buildAudioClips(
  clips: AssembledClip[],
  soundtrackId: string | null,
  timelineDurationSec: number,
): AudioClip[] {
  const audioClips: AudioClip[] = [];
  let order = 1;

  if (!clips.length) return audioClips;

  // Per-clip speech/ambient tracks
  for (const clip of clips) {
    if (clip.audio === "mute") continue;

    if (clip.audio === "keep" && clip.hasSpeech) {
      audioClips.push({
        order: order++,
        sourceCandidateId: clip.candidateId,
        startSec: 0, // placeholder — will be offset below
        endSec: 0,   // placeholder
        kind: "speech",
        gain: 1.0,
      });
    } else if (clip.audio === "duck") {
      audioClips.push({
        order: order++,
        sourceCandidateId: clip.candidateId,
        startSec: 0, // placeholder
        endSec: 0,   // placeholder
        kind: "ambient",
        gain: 0.3,
      });
    }
    // keep without speech → no explicit audio clip (original audio plays)
  }

  // Offset per-clip audio clips to their position in the film timeline
  let currentTime = 0;
  for (const clip of clips) {
    const dur = clipDuration(clip);
    if (dur <= 0) {
      currentTime += dur;
      continue;
    }

    // Find and offset audio clips belonging to this clip
    for (const ac of audioClips) {
      if (ac.sourceCandidateId === clip.candidateId && ac.kind !== "music") {
        ac.startSec = currentTime;
        ac.endSec = currentTime + dur;
      }
    }

    currentTime += dur;
  }

  // Music track: one clip spanning the film with fades at both ends
  if (soundtrackId) {
    const fadeDuration = fadeOutSec(timelineDurationSec);
    const hasLoudPeak = clips.some(clip => (clip.loudPeak ?? 0) >= 0.7);
    const musicGain = hasLoudPeak ? 0.45 : 0.6; // lower bed under loud cheers, laughs or splashes

    const track = loadLibrary().find((item) => item.id === soundtrackId);
    const analysis = track?.analysis;
    const trackDuration = analysis?.durationSec ?? track?.durationSec ?? timelineDurationSec;
    const outroStart = analysis?.ending.outroStartSec ?? 0;
    if (trackDuration > timelineDurationSec + 1 && outroStart > 1 && timelineDurationSec >= 12 && trackDuration - outroStart >= 3) {
      const tailDuration = Math.min(trackDuration - outroStart, Math.max(3, Math.min(timelineDurationSec / 3, 16)));
      const outroSourceIn = trackDuration - tailDuration;
      const joinSec = timelineDurationSec - tailDuration;
      const crossfadeSec = Math.min(0.5, joinSec, tailDuration);
      audioClips.push({ order: order++, sourceCandidateId: soundtrackId, startSec: 0, endSec: joinSec + crossfadeSec, kind: "music", gain: musicGain, sourceInSec: 0, sourceOutSec: joinSec + crossfadeSec, fadeInSec: Math.min(1, timelineDurationSec * 0.05), fadeOutSec: crossfadeSec });
      audioClips.push({ order: order++, sourceCandidateId: soundtrackId, startSec: joinSec, endSec: timelineDurationSec, kind: "music", gain: musicGain, sourceInSec: outroSourceIn, sourceOutSec: trackDuration, fadeInSec: crossfadeSec, fadeOutSec: fadeDuration });
    } else if (trackDuration > 0 && trackDuration < timelineDurationSec) {
      // Repeat short soundtracks with a small overlap so the film never has a
      // silent tail. Each source range remains within the actual audio file.
      const crossfadeSec = Math.min(0.5, trackDuration / 4);
      const stepSec = Math.max(trackDuration - crossfadeSec, trackDuration * 0.75);
      for (let startSec = 0; startSec < timelineDurationSec; startSec += stepSec) {
        const endSec = Math.min(timelineDurationSec, startSec + trackDuration);
        const isFirst = startSec === 0;
        const isLast = endSec >= timelineDurationSec;
        audioClips.push({
          order: order++, sourceCandidateId: soundtrackId, startSec, endSec,
          kind: "music", gain: musicGain, sourceInSec: 0,
          sourceOutSec: endSec - startSec,
          fadeInSec: isFirst ? Math.min(1, timelineDurationSec * 0.05) : crossfadeSec,
          fadeOutSec: isLast ? fadeDuration : crossfadeSec,
        });
      }
    } else audioClips.push({
      order: order++, sourceCandidateId: soundtrackId, startSec: 0,
      endSec: timelineDurationSec, kind: "music", gain: musicGain,
      sourceInSec: 0, sourceOutSec: timelineDurationSec,
      fadeInSec: Math.min(1, timelineDurationSec * 0.05), fadeOutSec: fadeDuration,
    });

    // Reduce music gain under speech clips (ducking)
    const speechTimes = audioClips
      .filter(ac => ac.kind === "speech")
      .map(ac => ({ start: ac.startSec, end: ac.endSec }));

    if (speechTimes.length > 0) {
      // For simplicity: reduce music gain globally when speech is present
      // A more sophisticated implementation would do time-range ducking
      audioClips.forEach(ac => {
        if (ac.kind === "music") {
          ac.gain = Math.max(0.2, musicGain - 0.3); // duck to at least 0.2
        }
      });

      // Apply per-segment ducking: for each speech segment, reduce music gain in that range
      // This is tracked via the speechTimes array; a full implementation would split the music clip
    }
  }

  return audioClips;
}
