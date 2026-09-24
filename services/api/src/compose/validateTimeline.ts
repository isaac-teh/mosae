import type { Timeline } from "@mosae/contracts";
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
  /** Accepted proposal chapter inputs (itemIds per chapter). */
  chapters: Array<{ index: number; itemIds: string[] }>;
  /** Asset registry keyed by itemId. */
  assets: Map<string, { kind: "photo" | "video"; analysis?: { shots?: Array<{ id: string }> } }>;
  /** Candidate map keyed by candidate id, which is also the Timeline clip id. */
  candidates: Map<string, Candidate>;
  /** Soundtrack IDs that are valid. */
  soundtrackIds: Set<string>;
}

/** Validate a composed timeline against semantic rules. Returns issues found. */
export function validateTimeline(
  timeline: Timeline,
  ctx: ValidationContext,
): TimelineIssue[] {
  const issues: TimelineIssue[] = [];

  // Rule 1: Every clip traces back to a candidate this composition offered, and
  // that candidate's moment is one the accepted proposal still contains. The
  // clip *id* is the candidate id; `source.shotId` is the shot the renderer
  // resolves, so the join runs through the id, not through the shot.
  for (const clip of timeline.videoClips) {
    const candidate = ctx.candidates.get(clip.id);
    if (!candidate) {
      issues.push({ path: `videoClips[${clip.id}]`, message: `unknown candidate ${clip.id}`, severity: "fatal" });
      continue;
    }
    // Check that the candidate's itemId is in an accepted chapter
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

  // Rule 4: Clips are contiguous (no gaps, no overlaps except crossfade/dip)
  const sortedClips = [...timeline.videoClips].sort((a, b) => a.startSec - b.startSec);
  for (let i = 0; i < sortedClips.length - 1; i++) {
    const currentEnd = sortedClips[i].startSec + sortedClips[i].durationSec;
    const nextStart = sortedClips[i + 1].startSec;
    const gap = nextStart - currentEnd;

    if (gap > 0.05) {
      issues.push({ path: `videoClips[${sortedClips[i].id}]→[${sortedClips[i + 1].id}]`, message: `gap of ${gap.toFixed(2)}s between clips`, severity: "fixable" });
    } else if (gap < -0.05) {
      // Overlap is only allowed for crossfade/dip transitions
      const currentClip = sortedClips[i];
      if (currentClip.transitionIn.kind !== "crossfade" && currentClip.transitionIn.kind !== "dip") {
        issues.push({ path: `videoClips[${sortedClips[i].id}]→[${sortedClips[i + 1].id}]`, message: `overlap of ${Math.abs(gap).toFixed(2)}s without crossfade/dip transition`, severity: "fixable" });
      }
    }
  }

  // Rule 5: Duration within 10% of target (target is the sum of clip durations)
  const totalDuration = sortedClips.reduce((sum, c) => sum + c.durationSec, 0);
  if (Math.abs(totalDuration - timeline.durationSec) > timeline.durationSec * 0.1) {
    issues.push({ path: "durationSec", message: `film duration ${totalDuration.toFixed(1)}s not within 10% of target ${timeline.durationSec}s`, severity: "fixable" });
  }

  // Rule 6: Captions inside their clip's time range
  for (const caption of timeline.captions) {
    const inClip = sortedClips.some(c => caption.startSec >= c.startSec && caption.endSec <= c.startSec + c.durationSec);
    if (!inClip) {
      issues.push({ path: `captions[${caption.text.slice(0, 20)}]`, message: `caption [${caption.startSec},${caption.endSec}] not inside any clip`, severity: "fixable" });
    }
  }

  // Rule 7: Every assetId and soundtrackId resolves
  for (const audio of timeline.audioClips) {
    if (audio.source.kind === "asset") {
      const assetId = audio.source.assetId;
      if (!ctx.assets.has(assetId)) {
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

/**
 * Repair a timeline once by fixing fixable issues deterministically.
 * No model call — clamp holds, drop illegal clips, re-run reflow.
 * Runs at most once. Returns repaired timeline or the original with reasons.
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

  let repaired = JSON.parse(JSON.stringify(timeline)) as Timeline;

  // Fix 1: Clamp photo holds to cadence bounds
  for (const clip of repaired.videoClips) {
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
  repaired.videoClips = repaired.videoClips.filter(clip => {
    const candidate = ctx.candidates.get(clip.id);
    if (!candidate || clip.source.kind !== "video") return true;

    const inSec = clip.source.sourceInSec;
    const outSec = clip.source.sourceOutSec;
    if (inSec < (candidate.inSec ?? 0) - 0.01 || outSec > (candidate.outSec ?? Infinity) + 0.01) {
      return false; // Drop this clip
    }
    return true;
  });

  // Fix 3: Re-run reflow — adjust clip positions to be contiguous
  let currentTime = 0;
  for (const clip of repaired.videoClips) {
    clip.startSec = currentTime;
    currentTime += clip.durationSec;
  }

  // Update duration to match the adjusted clips
  repaired.durationSec = currentTime;

  return { ok: true, timeline: repaired };
}
