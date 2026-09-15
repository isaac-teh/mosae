import { expect, test } from "@playwright/test";
import { FIXTURES } from "./scenarios";

// Requires: Firebase emulators, services/api on 8080 with ALLOWED_ORIGINS=http://localhost:8081,
// and apps/client built with EXPO_PUBLIC_USE_EMULATORS=true.
test("uploads picked media and reaches the story step", async ({ page }) => {
  const failures: string[] = [];
  page.on("requestfailed", (r) => failures.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(FIXTURES);
  await page.waitForURL("**/pick-memory");
  await page.getByRole("button", { name: "Next" }).click();

  await page.waitForURL(/\/tell-story\?/, { timeout: 60_000 });
  const url = new URL(page.url());
  expect(url.searchParams.get("projectId")).toMatch(/.+/);
  expect(url.searchParams.get("count")).toBe("4");
  await expect(page.getByText("from your 4 memories.")).toBeVisible();
  expect(failures).toEqual([]);
});
