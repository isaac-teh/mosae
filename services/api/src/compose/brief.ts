import { CADENCES, type CadenceId } from "@mosae/contracts";

/** Hold lengths in seconds for a still or a quiet shot, chosen by the story's mood. */
export interface Holds {
  base: number;
  min: number;
  max: number;
}

// Hold table keyed directly by CadenceId — no mapping, no substring matching.
const HOLDS: Record<CadenceId, Holds> = {
  tender: { base: 4, min: 2.5, max: 5 },
  reflective: { base: 4.5, min: 3, max: 5 },
  playful: { base: 2, min: 1, max: 3.5 },
  energetic: { base: 1.5, min: 1, max: 2.5 },
  celebratory: { base: 2.5, min: 1.5, max: 4 },
};

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
    `- Mood "${moodName}": hold a still about ${h.base}s, never under ${h.min}s, never over ${h.max}s.`,
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
    "- At most one short overlay per chapter, naming a place or a moment. Never caption what the viewer can see.",
    "",
    "Audio",
    '- Keep audio on speech and on sound that belongs to the moment; mute or duck it elsewhere.',
  ].join("\n");
}
