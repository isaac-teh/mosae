export const models = {
  analyze: 'gemini-3.5-flash-lite',
  analyzeCompare: 'gemini-3.1-flash-lite',
  story: 'gemini-3.5-flash-lite',
  compose: 'gemini-3.5-flash-lite',
  embed: 'gemini-embedding-2',
} as const;

export const prices: Record<string, { input: number; output: number; audioInput?: number }> = {
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.1-flash-lite': { input: 0.25, audioInput: 0.50, output: 1.50 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.1-pro-preview': { input: 2.00, output: 12.00 },
  'gemini-embedding-2': { input: 0.20, output: 0 },
};
export const defaultIntents: Record<string, string> = {
  trip: "This was our first family trip to Japan for my daughter's birthday. Focus on moments of her having fun, the food we tried, and the quiet places we explored together.",
  creator: 'Make a 60 second reel about a day of work, talking head as the spine with B-roll cutaways.',
};
export const targetDuration: Record<string, number> = { trip: 90, creator: 60 };
export const ROOT = new URL('.', import.meta.url).pathname;
