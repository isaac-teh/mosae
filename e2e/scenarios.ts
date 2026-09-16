import path from "node:path";
import type { Page } from "@playwright/test";
import { figmaScenarios } from "./figma-scenarios";

const fixture = (name: string) => path.join(__dirname, "fixtures", name);
export const FIXTURES = ["photo-1.jpg", "photo-2.jpg", "photo-3.jpg", "clip-1.mp4"].map(fixture);

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

export type Scenario = { name: string; run: (page: Page) => Promise<void> };

export const scenarios: Scenario[] = [
  {
    name: "landing",
    run: async (page) => {
      await page.goto("/");
      await settle(page);
    },
  },
  {
    name: "pick-memory-empty",
    run: async (page) => {
      await page.goto("/pick-memory");
      await settle(page);
    },
  },
  {
    name: "pick-memory-grid",
    run: async (page) => {
      await page.goto("/");
      await page.locator('input[type="file"]').setInputFiles(FIXTURES);
      await page.waitForURL("**/pick-memory");
      await page.getByText("0:05").waitFor();
      await page.getByRole("button", { name: "photo-2.jpg" }).click();
      await settle(page);
    },
  },
  {
    name: "tell-story",
    run: async (page) => {
      await page.goto("/tell-story?projectId=p1&count=3");
      await settle(page);
    },
  },
  {
    name: "tell-story-filled",
    run: async (page) => {
      await page.goto("/tell-story?projectId=p1&count=3");
      await page.getByRole("textbox").fill("Our first family trip to Japan.");
      await page.getByRole("button", { name: /Birthday celebration/ }).click();
      await page.getByRole("button", { name: /Goofy moments/ }).click();
      await settle(page);
    },
  },
  ...figmaScenarios.map(({ name, run }) => ({ name, run })),
];
