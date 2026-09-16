export const models = {
  analyze: 'gemini-3.1-flash-lite',
  analyzeCompare: 'gemini-3.5-flash-lite',
  story: 'gemini-3.5-flash-lite',
  compose: 'gemini-3.8-flash',
  embed: 'gemini-embedding-2',
} as const;

export const prices: Record<string, { input: number; output: number; audioInput?: number }> = {
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.1-flash-lite': { input: 0.25, audioInput: 0.50, output: 1.50 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.1-pro-preview': { input: 2.00, output: 12.00 },
  'gemini-2.5-flash-lite': { input: 0.10, audioInput: 0.30, output: 0.40 },
  'gemini-2.5-flash': { input: 0.30, audioInput: 1.00, output: 2.50 },
  'gemini-embedding-2': { input: 0.20, output: 0 },
};
export const defaultIntents: Record<string, string> = {
  trip: "This was our first family trip to Japan for my daughter's birthday. Focus on moments of her having fun, the food we tried, and the quiet places we explored together.",
  creator: 'Make a 60 second reel about a day of work, talking head as the spine with B-roll cutaways.',
};
export const targetDuration: Record<string, number> = { trip: 90, creator: 60 };
export const ROOT = new URL('.', import.meta.url).pathname;

// Cheap candidates probed one file at a time before any full run (08-probe.ts).
// gemini-2.5-flash-lite is closed to new users; Flash tiers reject MINIMAL thinking.
export const thinkingLevelFor = (model: string) => /flash-lite|2\.5-flash$/.test(model) ? 'MINIMAL' : 'LOW';
export const probeModels = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'] as const;
