import { reflow, type AudioClip, type Caption, type ClipPlan, type Timeline, type VideoClip } from "@mosae/contracts";
import type { Candidate } from "./buildCandidates.js";

/** A semantic issue found during validation. */
export interface TimelineIssue {
  /** Which part of the timeline has the problem. */
  path: string;
  /** Human-readable description. */
  message: string;
  /** Severity: fixable or fatal. */
  severity: "fixable" | "fatal";
}

/** Context available for validation — the accepted proposal and asset registry. */
export interface ValidationContext {
  /** Accepted proposal chapter inputs (itemIds per chapter), in timeline chapter order. */
  chapters: Array<{ index: number; itemIds: string[] }>;
  /**
   * Every shot the accepted proposal names. A Timeline's `source.shotId` and an
   * asset audio clip's `assetId` are both resolved through this, because both
   * are ids the renderer must turn into a file.
   */
  shotIds: Set<string>;
  /** Candidate map keyed by candidate id, which is also the Timeline clip id. */
  candidates: Map<string, Candidate>;
  /** Soundtrack IDs that are valid. */
  soundtrackIds: Set<string>;
  /**
   * The length this film is committed to, in seconds — the requested target, or
   * the shortened one when the proposal had too little media to reach it.
   * Rule 5 measures the film against this. Measuring it against its own
   * `durationSec` compares the film with itself and can only ever fire by
   * accident, which is what let crossfade overlaps through unnoticed.
   */
  targetSec: number;
  /** Frame rate the repair re-flows at. Defaults to the timeline's own. */
  fps?: number;
}

const TEN_PERCENT = 0.1;

/** Validate a composed timeline against semantic rules. Returns issues found. */
export function validateTimeline(
  timeline: Timeline,
  ctx: ValidationContext,
): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  const videoClips = timeline.videoClips.filter((clip): clip is VideoClip => "source" in clip);

  for (const clip of videoClips) {
    // Rule 1: the clip traces back to a candidate this composition offered, the
    // shot it names is a real shot in this project, and the moment behind it is
    // one the accepted proposal still contains. The shot is checked directly —
    // it is what the renderer resolves to a file, and an upstream constructor
    // that happens to build it correctly is not a gate.
    const candidate = ctx.candidates.get(clip.id);
    if (!candidate) {
      issues.push({ path: `videoClips[${clip.id}]`, message: `unknown candidate ${clip.id}`, severity: "fatal" });
      continue;
    }

    if (!ctx.shotIds.has(clip.source.shotId)) {
      issues.push({
        path: `videoClips[${clip.id}].source.shotId`,
        message: `unknown shot ${clip.source.shotId}`,
        severity: "fatal",
      });
    }

    const foundInChapter = ctx.chapters.some(ch => ch.itemIds.includes(candidate.itemId));
    if (!foundInChapter) {
      issues.push({ path: `videoClips[${clip.id}].source.shotId`, message: `clip ${clip.id} belongs to deselected moment (itemId=${candidate.itemId})`, severity: "fatal" });
    }

    // Rule 2: Video range sits inside its shot
    if (clip.source.kind === "video") {
      const inSec = clip.source.sourceInSec;
      const outSec = clip.source.sourceOutSec;
      if (candidate.inSec != null && candidate.outSec != null) {
        if (inSec < candidate.inSec - 0.01 || outSec > candidate.outSec + 0.01) {
          issues.push({ path: `videoClips[${clip.id}].source`, message: `range [${inSec},${outSec}] outside shot [${candidate.inSec},${candidate.outSec}]`, severity: "fixable" });
        }
      }
    }

    // Rule 3: Photo hold within cadence bounds
    if (clip.source.kind === "photo") {
      const duration = clip.durationSec;
      if (duration < (candidate.minHoldSec ?? 0) - 0.01 || duration > (candidate.maxHoldSec ?? Infinity) + 0.01) {
        issues.push({ path: `videoClips[${clip.id}].durationSec`, message: `hold ${duration}s outside bounds [${candidate.minHoldSec ?? "?"},${candidate.maxHoldSec ?? "?"}]s`, severity: "fixable" });
      }
    }
  }

  // Rule 4: Clips are contiguous — no gaps, and an overlap only where the
  // INCOMING clip declares one. `transitionIn` is the transition into a clip,
  // so the boundary between N-1 and N is clip N's to declare.
  const sortedClips = [...videoClips].sort((a, b) => a.startSec - b.startSec);
  for (let i = 0; i < sortedClips.length - 1; i++) {
    const currentEnd = sortedClips[i].startSec + sortedClips[i].durationSec;
    const incoming = sortedClips[i + 1];
    const gap = incoming.startSec - currentEnd;

    if (gap > 0.05) {
      issues.push({ path: `videoClips[${sortedClips[i].id}]→[${incoming.id}]`, message: `gap of ${gap.toFixed(2)}s between clips`, severity: "fixable" });
    } else if (gap < -0.05) {
      if (incoming.transitionIn.kind !== "crossfade") {
        issues.push({ path: `videoClips[${sortedClips[i].id}]→[${incoming.id}]`, message: `overlap of ${Math.abs(gap).toFixed(2)}s without a crossfade into ${incoming.id}`, severity: "fixable" });
      } else if (Math.abs(gap) - incoming.transitionIn.durationSec > 0.05) {
        issues.push({ path: `videoClips[${sortedClips[i].id}]→[${incoming.id}]`, message: `overlap of ${Math.abs(gap).toFixed(2)}s exceeds the declared crossfade of ${incoming.transitionIn.durationSec}s`, severity: "fixable" });
      }
    }
  }

  // Rule 5: the film lands within 10% of the target it is committed to.
  if (Math.abs(timeline.durationSec - ctx.targetSec) > ctx.targetSec * TEN_PERCENT) {
    issues.push({
      path: "durationSec",
      message: `film duration ${timeline.durationSec.toFixed(2)}s not within 10% of target ${ctx.targetSec}s`,
      severity: "fixable",
    });
  }

  // Rule 6: Captions inside their clip's time range
  for (const caption of timeline.captions) {
    const inClip = sortedClips.some(c => caption.startSec >= c.startSec - 0.01 && caption.endSec <= c.startSec + c.durationSec + 0.01);
    if (!inClip) {
      issues.push({ path: `captions[${caption.text.slice(0, 20)}]`, message: `caption [${caption.startSec},${caption.endSec}] not inside any clip`, severity: "fixable" });
    }
  }

  // Rule 7: Every assetId and soundtrackId resolves
  for (const audio of timeline.audioClips) {
    if (audio.source.kind === "asset") {
      const assetId = audio.source.assetId;
      if (!ctx.shotIds.has(assetId)) {
        issues.push({ path: `audioClips[${audio.id}].source.assetId`, message: `unknown asset ${assetId}`, severity: "fatal" });
      }
    } else if (audio.source.kind === "soundtrack") {
      const soundtrackId = audio.source.soundtrackId;
      if (!ctx.soundtrackIds.has(soundtrackId)) {
        issues.push({ path: `audioClips[${audio.id}].source.soundtrackId`, message: `unknown soundtrack ${soundtrackId}`, severity: "fatal" });
      }
    }
  }

  return issues;
}

type Geometry = { startSec: number; durationSec: number };

/**
 * Repair a timeline once by fixing fixable issues deterministically.
 * No model call — clamp holds, drop illegal clips, re-run the shared `reflow`.
 *
 * Re-running the *real* reflow matters: a cumulative walk of its own would
 * quantize nothing and honour no crossfade, so a repair would silently flatten
 * every overlap in the film and push the speech under it out of lip sync. Every
 * layer that hangs off the picture — chapter starts, audio, captions — is
 * recomputed against the new geometry rather than left pointing at the old.
 *
 * Runs at most once. Returns the repaired timeline or the original with reasons.
 */
export function repairOnce(
  timeline: Timeline,
  issues: TimelineIssue[],
  ctx: ValidationContext,
): { ok: true; timeline: Timeline } | { ok: false; reasons: string[] } {
  // Check for fatal issues first — cannot repair those regardless of fixable count
  if (issues.some(i => i.severity === "fatal")) {
    const reasons = issues.map(i => `${i.path}: ${i.message}`);
    return { ok: false, reasons };
  }

  const fixableIssues = issues.filter(i => i.severity === "fixable");
  if (fixableIssues.length === 0) return { ok: true, timeline };
  if (timeline.videoClips.some((clip) => "kind" in clip)) {
    return { ok: false, reasons: ["automatic repair of a collage timeline is unsupported"] };
  }

  const videoClips = timeline.videoClips.filter((clip): clip is VideoClip => "source" in clip);
  const repaired = JSON.parse(JSON.stringify(timeline)) as Timeline;
  let repairedVideoClips = repaired.videoClips.filter((clip): clip is VideoClip => "source" in clip);
  const fps = ctx.fps ?? timeline.fps;

  // What the picture looked like before the repair, so everything laid over it
  // can be moved with it rather than guessed at afterwards.
  const before = new Map<string, Geometry>(
    videoClips.map((clip) => [clip.id, { startSec: clip.startSec, durationSec: clip.durationSec }]),
  );

  // Fix 1: Clamp photo holds to cadence bounds
  for (const clip of repairedVideoClips) {
    if (clip.source.kind === "photo") {
      const candidate = ctx.candidates.get(clip.id);
      if (!candidate || candidate.minHoldSec == null || candidate.maxHoldSec == null) continue;

      if (clip.durationSec < candidate.minHoldSec) {
        clip.durationSec = candidate.minHoldSec;
      } else if (clip.durationSec > candidate.maxHoldSec) {
        clip.durationSec = candidate.maxHoldSec;
      }
    }
  }

  // Fix 2: Drop clips with ranges outside their shot bounds
  repairedVideoClips = repairedVideoClips.filter(clip => {
    const candidate = ctx.candidates.get(clip.id);
    if (!candidate || clip.source.kind !== "video") return true;

    const inSec = clip.source.sourceInSec;
    const outSec = clip.source.sourceOutSec;
    return !(inSec < (candidate.inSec ?? 0) - 0.01 || outSec > (candidate.outSec ?? Infinity) + 0.01);
  });

  if (repairedVideoClips.length === 0) {
    return { ok: false, reasons: ["repair dropped every clip — no film left"] };
  }

  // Fix 3: re-run the shared reflow over what survived.
  const flowed = reflow({
    fps,
    plans: repairedVideoClips.map((clip): ClipPlan => {
      const candidate = ctx.candidates.get(clip.id);
      return {
        id: clip.id,
        source: clip.source,
        durationSec: clip.durationSec,
        transitionIn: clip.transitionIn,
        strength: 0,
        minHoldSec: candidate?.minHoldSec ?? 0,
        maxHoldSec: candidate?.maxHoldSec ?? Infinity,
      };
    }),
    // Chapter starts are recomputed below from the moment each surviving clip
    // belongs to. Reflow's own mapping assigns clips to moments by position,
    // which a dropped clip invalidates.
    chapters: [],
  });

  const after = new Map<string, Geometry>();
  repairedVideoClips = repairedVideoClips.map((clip, index) => {
    const flowedClip = flowed.clips[index];
    after.set(clip.id, { startSec: flowedClip.startSec, durationSec: flowedClip.durationSec });
    return { ...clip, startSec: flowedClip.startSec, durationSec: flowedClip.durationSec };
  });
  repaired.durationSec = flowed.durationSec;

  // Chapters: each chapter starts at the first surviving clip belonging to one
  // of its moments. A chapter that lost every clip is no longer in the film.
  const survivingByChapter = ctx.chapters.map((chapter) => {
    const starts = repairedVideoClips
      .filter((clip) => {
        const candidate = ctx.candidates.get(clip.id);
        return candidate ? chapter.itemIds.includes(candidate.itemId) : false;
      })
      .map((clip) => clip.startSec);
    return starts.length > 0 ? Math.min(...starts) : null;
  });
  if (ctx.chapters.length === repaired.chapters.length) {
    repaired.chapters = repaired.chapters
      .map((chapter, index) => ({ ...chapter, startSec: survivingByChapter[index] }))
      .filter((chapter): chapter is { title: string; startSec: number } => chapter.startSec != null);
  }

  // Audio follows the picture it belongs to. An asset clip was laid at its
  // picture's start, so it is matched back by shot and start and moved to
  // wherever that picture now sits; if the picture was dropped, so is its sound.
  repaired.audioClips = repaired.audioClips.flatMap((audio): AudioClip[] => {
    if (audio.source.kind === "soundtrack") {
      return [{ ...audio, startSec: 0, source: { ...audio.source, sourceInSec: 0, sourceOutSec: repaired.durationSec } }];
    }
    const assetId = audio.source.assetId;
    const owner = videoClips.find(
      (clip) => clip.source.shotId === assetId && Math.abs(clip.startSec - audio.startSec) < 0.05,
    );
    const moved = owner ? after.get(owner.id) : undefined;
    // The picture this sound belongs to is gone, so the sound goes with it.
    if (!moved) return [];
    const length = Math.min(audio.source.sourceOutSec - audio.source.sourceInSec, moved.durationSec);
    if (length <= 0) return [];
    return [{
      ...audio,
      startSec: moved.startSec,
      source: { ...audio.source, sourceOutSec: audio.source.sourceInSec + length },
    }];
  });

  // Captions ride the clip they were written over.
  repaired.captions = repaired.captions.flatMap((caption): Caption[] => {
    const owner = videoClips.find(
      (clip) => caption.startSec >= clip.startSec - 0.01 && caption.endSec <= clip.startSec + clip.durationSec + 0.01,
    );
    const moved = owner ? after.get(owner.id) : undefined;
    const was = owner ? before.get(owner.id) : undefined;
    if (!owner || !moved || !was) return [];
    const offset = caption.startSec - was.startSec;
    const startSec = moved.startSec + Math.min(offset, moved.durationSec);
    const endSec = Math.min(moved.startSec + moved.durationSec, startSec + (caption.endSec - caption.startSec));
    if (endSec <= startSec) return [];
    return [{ ...caption, startSec, endSec }];
  });

  repaired.videoClips = repairedVideoClips;
  return { ok: true, timeline: repaired };
}
