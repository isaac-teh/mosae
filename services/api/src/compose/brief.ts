import { CADENCES, type CadenceId } from "@mosae/contracts";
import { styleRecipeForCadence } from "./styleRecipe.js";

/** Hold lengths in seconds for a still or a quiet shot, chosen by the story's mood. */
export interface Holds {
  base: number;
  min: number;
  max: number;
}

// Hold table keyed directly by CadenceId — no mapping, no substring matching.
/**
 * Look up holds for a cadence id. Total over CadenceId — the type system enforces exhaustiveness.
 */
export function holdsFor(cadenceId: CadenceId): Holds {
  const [min, max] = styleRecipeForCadence(cadenceId).photoHold;
  return { base: (min + max) / 2, min, max };
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
  const recipe = styleRecipeForCadence(cadenceId);

  return [
    `You are cutting a short film from someone's own photos and videos. Judge it as film, not as a gallery.`,
    "",
    "Rhythm",
    `- Mood "${moodName}": photo clips hold ${h.min.toFixed(2)}–${h.max.toFixed(2)}s (base ${h.base.toFixed(2)}s).`,
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
    `- Default to a ${recipe.transitions.default} (${recipe.transitions.crossfadeSec.toFixed(1)}s); cut into the peak. Use a dip only at a real break.`,
    `- Prefer soundtrack moods: ${recipe.musicMood.join(", ")}. Cut on the ${recipe.cutOn}.`,
    "- Nothing else. No wipes, slides, or spins.",
    "",
    "Text",
    "- Text overlays are optional. Never generate day, chapter, or date labels. Use an overlay only when a short line adds a real story beat; never caption what the viewer can see.",
    "",
    "Audio",
    '- Keep audio on speech and on sound that belongs to the moment; mute or duck it elsewhere.',
  ].join("\n");
}
