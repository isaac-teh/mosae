import path from "node:path";
import { test } from "@playwright/test";
import { scenarios } from "./scenarios";

for (const scenario of scenarios) {
  test(`capture ${scenario.name}`, async ({ page }) => {
    await scenario.run(page);
    await page.screenshot({ path: path.join(__dirname, "baseline", `${scenario.name}.png`), fullPage: true });
  });
}
