// The editing brief handed to the composition model.
// Written for Mosae from first principles: structural rules alone produced
// equal-length photo slideshows, so this states what a good cut looks like.

type Holds = { base: number; min: number; max: number };

// Hold lengths in seconds for a still or a quiet shot, chosen by the story's mood.
const HOLDS: Record<string, Holds> = {
  tender: { base: 3.5, min: 2, max: 6 },
  reflective: { base: 4, min: 2.5, max: 7 },
  playful: { base: 2.2, min: 1.5, max: 4 },
  energetic: { base: 1.6, min: 1, max: 3 },
  celebratory: { base: 2.5, min: 1.5, max: 4.5 },
};
const DEFAULT_HOLDS: Holds = { base: 3, min: 1.5, max: 5 };

export function holdsFor(mood = '') {
  const key = Object.keys(HOLDS).find(k => mood.toLowerCase().includes(k));
  return key ? HOLDS[key] : DEFAULT_HOLDS;
}

export function craftBrief(mood: string, targetSec: number) {
  const h = holdsFor(mood);
  return [
    'You are cutting a short film from someone\'s own photos and videos. Judge it as film, not as a gallery.',
    '',
    'Rhythm',
    `- Mood "${mood || 'unspecified'}": hold a still about ${h.base}s, never under ${h.min}s, never over ${h.max}s.`,
    '- The strongest moment in each chapter gets the longest hold. Ordinary connective shots get the shortest.',
    '- Vary the holds. Three shots of identical length in a row reads as a slideshow, which is a failed edit.',
    `- Total length must land within 10% of ${targetSec}s. Shorten ordinary shots first, never the strongest ones.`,
    '',
    'Motion',
    '- Moving footage carries a film. Every selected video must contribute at least one clip; stills bridge between them.',
    '- Open and close on the strongest material available, and prefer motion for both.',
    '',
    'Trimming video',
    '- A clip usually holds one moment worth keeping and a lot of setup. Take the moment, using the analyzed shots and the best-moment timestamp.',
    '- Cut just before an action finishes rather than after it settles: it reads as intentional instead of tired.',
    '- Stay inside one analyzed shot, and never cut through a sentence in the transcript.',
    '',
    'Order',
    '- Follow the chapter order; it carries the story. Within a chapter, arrange for contrast rather than by score.',
    '- Do not place two visually similar shots side by side. Separate them with a different subject, scale, or setting.',
    '- Alternate scale where you can: a wide establishing shot, then something closer and human.',
    '',
    'Transitions',
    '- Use hard cuts for most of the film, a crossfade between shots that belong to the same feeling or mark time passing, and a dip only at a real break.',
    '- Nothing else. No wipes, slides, or spins.',
    '',
    'Text',
    '- At most one short overlay per chapter, naming a place or a moment. Never caption what the viewer can see.',
    '',
    'Audio',
    '- Keep audio on speech and on sound that belongs to the moment; mute or duck it elsewhere.',
  ].join('\n');
}
