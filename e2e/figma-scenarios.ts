import type { Page } from "@playwright/test";

export async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined))));
  await page.waitForTimeout(300);
}

export type FigmaScenario = { name: string; height: number; run: (page: Page) => Promise<void> };

// Each screen task replaces its entry's run with the steps that reach the Figma state.
export const figmaScenarios: FigmaScenario[] = [
  { name: "review-moments", height: 1533, run: async (page) => { await page.goto("/review-moments?planId=demo"); await settle(page); } },
  { name: "curated-timeline", height: 2631, run: async (page) => { await page.goto("/curated-timeline?planId=demo"); await settle(page); } },
  { name: "create", height: 1000, run: async (page) => { await page.goto("/create?planId=demo"); await page.getByRole("radio", { name: "Sync to Apple Photos" }).click(); await settle(page); } },
  { name: "direct-film", height: 1052, run: async (page) => { await page.goto("/direct-film?planId=demo"); await settle(page); } },
  { name: "review-film", height: 905, run: async (page) => { await page.goto("/review-film?filmId=demo-film"); await settle(page); } },
  { name: "save-film", height: 905, run: async (page) => { await page.goto("/save-film?filmId=demo-film"); await settle(page); } },
];
