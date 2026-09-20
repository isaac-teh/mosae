/**
 * USD per one million tokens, standard paid tier. Thinking tokens bill at the
 * output rate. Copied from the rates validated in the Gemini PoC; update here
 * when Google changes them so every stage's estimate moves together.
 */
export const PRICES: Record<string, { input: number; output: number }> = {
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-3.1-pro-preview": { input: 2.0, output: 12.0 },
  "gemini-embedding-2": { input: 0.2, output: 0 },
};

/**
 * Stage to model. The PoC report measured these on the trip and creator sets:
 * 3.1-flash-lite passed composition validation on both, while 3.5-flash-lite
 * failed the creator set, so composition defaults to 3.1.
 */
export const MODELS = {
  analyze: "gemini-3.1-flash-lite",
  story: "gemini-3.5-flash-lite",
  compose: "gemini-3.1-flash-lite",
  embed: "gemini-embedding-2",
} as const;
