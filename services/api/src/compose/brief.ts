import { CADENCES, type CadenceId } from "@mosae/contracts";
import { DIRECTING_RULES, photoHoldRange } from "./directingRules.js";

/** Hold lengths in seconds for a still or a quiet shot, chosen by the story's mood. */
export interface Holds {
  base: number;
  min: number;
  max: number;
}

// Hold table keyed directly by CadenceId — no mapping, no substring matching.
const HOLDS: Record<CadenceId, Holds> = Object.fromEntries(
  (Object.keys({ tender: 1, reflective: 1, playful: 1, energetic: 1, celebratory: 1 }) as CadenceId[])
    .map((cadence) => [cadence, photoHoldRange(1, cadence)]),
) as Record<CadenceId, Holds>;

for (const cadence of Object.keys(HOLDS) as CadenceId[]) {
  const lively = cadence === "playful" || cadence === "energetic";
  const [min, max] = lively ? DIRECTING_RULES.photoHolds.lively : DIRECTING_RULES.photoHolds.memory;
  HOLDS[cadence] = { base: (min + max) / 2, min, max };
}

const DEFAULT_HOLDS: Holds = { base: 3, min: 1, max: 5 };

/**
 * Look up holds for a cadence id. Total over CadenceId — the type system enforces exhaustiveness.
 */
export function holdsFor(cadenceId: CadenceId): Holds {
  return HOLDS[cadenceId] ?? DEFAULT_HOLDS;
}

/**
 * The editing brief handed to the composition model.
 * Written for Mosae from first principles: structural rules alone produced
 * equal-length photo slideshows, so this states what a good cut looks like.
 */
export function craftBrief(cadenceId: CadenceId, targetSec: number): string {
  const cadence = CADENCES.find(c => c.id === cadenceId);
  const moodName = cadence?.name ?? "unspecified";
  const h = holdsFor(cadenceId);

  return [
    `You are cutting a short film from someone's own photos and videos. Judge it as film, not as a gallery.`,
    "",
    "Rhythm",
    `- Mood "${moodName}": photo clips use ${h.base.toFixed(2)}s base pace for one photo, with ±20% variance (${h.min.toFixed(2)}–${h.max.toFixed(2)}s). Multi-photo collages scale as 1.0 + 0.2 × photos, then apply the cadence stretch.`,
    "- The strongest moment in each chapter gets the longest hold. Ordinary connective shots get the shortest.",
    "- Vary the holds. Three shots of identical length in a row reads as a slideshow, which is a failed edit.",
    `- Total length must land within 10% of ${targetSec}s. Shorten ordinary shots first, never the strongest ones.`,
    "",
    "Motion",
    "- Moving footage carries a film. Every selected video must contribute at least one clip; stills bridge between them.",
    "- Open and close on the strongest material available, and prefer motion for both.",
    "",
    "Trimming video",
    '- A clip usually holds one moment worth keeping and a lot of setup. Take the moment, using the analyzed shots and the best-moment timestamp.',
    "- Cut just before an action finishes rather than after it settles: it reads as intentional instead of tired.",
    "- Stay inside one analyzed shot, and never cut through a sentence in the transcript.",
    "",
    "Order",
    "- Follow the chapter order; it carries the story. Within a chapter, arrange for contrast rather than by score.",
    '- Do not place two visually similar shots side by side. Separate them with a different subject, scale, or setting.',
    "- Alternate scale where you can: a wide establishing shot, then something closer and human.",
    "",
    "Transitions",
    '- Use hard cuts for most of the film, a crossfade between shots that belong to the same feeling or mark time passing, and a dip only at a real break.',
    "- Nothing else. No wipes, slides, or spins.",
    "",
    "Text",
    "- Text overlays are optional. Never generate day, chapter, or date labels. Use an overlay only when a short line adds a real story beat; never caption what the viewer can see.",
    "",
    "Audio",
    '- Keep audio on speech and on sound that belongs to the moment; mute or duck it elsewhere.',
  ].join("\n");
}
