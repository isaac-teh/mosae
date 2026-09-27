import { ComposeResponseSchema, type ComposePicks } from "./assemble.js";
import type { Candidate } from "./buildCandidates.js";
import type { Holds } from "./brief.js";
import type { StoryProposal } from "@mosae/contracts";

/**
 * Build the prompt for the composition model.
 * Code offers legal clips, the model arranges them — no tool loop, no agent.
 */

export interface ComposeCallDeps {
  candidates: Candidate[];
  proposal: StoryProposal;
  brief: string;
  holds: Holds;
  /**
   * The user's directing note from the Review screen. The spec's revision
   * mechanism is this text reaching the model: it can reorder, retime and
   * re-transition what the accepted proposal already contains.
   */
  note?: string;
  /** The film's target length. `craftBrief` already states it; repeating it wrong is worse than not repeating it. */
  targetSec?: number;
  cast?: string;
}

/**
 * Build the structured prompt for Gemini composition call.
 * Returns the prompt text and the JSON schema for generateStructured.
 */
export function composeCall(deps: ComposeCallDeps): {
  prompt: string;
  schema: object;
} {
  const { candidates, proposal, brief, holds, note, targetSec, cast } = deps;

  // Build candidate map by ID for quick lookup in the prompt
  const byId = new Map(candidates.map(c => [c.candidateId, c]));

  // Format chapters with their items
  const chapterInfo = proposal.chapters.map((ch, index) => ({
    index,
    title: ch.title,
    summary: ch.summary,
    itemIds: ch.momentIds,
  }));

  // Format candidates for the prompt
  const candidateList = candidates.map(c => ({
    id: c.candidateId,
    kind: c.kind,
    itemId: c.itemId,
    chapterIndex: c.chapterIndex,
    ...(c.kind === "video" ? { inSec: c.inSec, outSec: c.outSec } : {}),
  }));

  const prompt = [
    brief,
    "",
    `You are choosing from clips that are already legal: every video range sits inside one shot and never cuts a sentence. Do not invent timestamps.`,
    "",
    "Rules:",
    `- Pick candidateIds in the order they should play, following chapter order. A source item may appear up to 3 times, but only through different candidates.`,
    "- Every chapter must contribute at least one clip.",
    `- For photo candidates give holdSec between ${holds.min} and ${holds.max}. Video clip length is fixed by the candidate.`,
    // The brief already carries the target. A second one computed from the
    // must-include count contradicted it — 5s against a 30s film, or "near 0s"
    // when the proposal names no must-includes.
    "- Small drift from the target is corrected afterwards by adjusting photo holds.",
    "",
    ...(note && note.trim()
      ? [
          "The person whose film this is asked for this, in their own words. It outranks your own preference about order, length and transitions, but it cannot add or remove media:",
          note.trim(),
          "",
        ]
      : []),
    ...(targetSec != null ? [`Target length: ${targetSec}s.`, ""] : []),
    ...(cast ? [`Cast: ${cast}. Keep every core family member on screen; end on the whole family together if possible.`, ""] : []),
    `Chapters: ${JSON.stringify(chapterInfo)}`,
    `Candidates: ${JSON.stringify(candidateList)}`,
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      clips: {
        type: "array",
        items: {
          type: "object",
          properties: {
            candidateId: { type: "string" },
            holdSec: { type: "number" },
            transition: { type: "string", enum: ["cut", "crossfade", "dip"] },
            textOverlay: { type: "string" },
            audio: { type: "string", enum: ["keep", "duck", "mute"] },
          },
          required: ["candidateId", "transition", "audio"],
        },
      },
      musicCues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            atSec: { type: "number" },
            cue: { type: "string" },
          },
          required: ["atSec", "cue"],
        },
      },
    },
    required: ["clips", "musicCues"],
  };

  return { prompt, schema };
}

/**
 * Validate the model's response against the schema.
 */
export function validateComposeResponse(
  raw: unknown,
): { ok: true; picks: ComposePicks } | { ok: false; errors: string[] } {
  const result = ComposeResponseSchema.safeParse(raw);
  if (result.success) return { ok: true, picks: result.data };
  return { ok: false, errors: result.error.issues.map(i => i.path.join(".") || "root") };
}
