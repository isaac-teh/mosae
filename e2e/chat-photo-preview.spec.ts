import { expect, test } from "@playwright/test";
import path from "node:path";

test("keeps signed chat photo sources stable for 30 seconds after the story answer", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page.getByRole("button", { name: /Create a new film/ }).click();
  await page.locator('input[type="file"]').setInputFiles([
    path.resolve("../services/api/fixtures/demo/trip1-v2/photos/d1-01.jpg"),
    path.resolve("../services/api/fixtures/demo/trip1-v2/photos/d1-02.jpg"),
    path.resolve("../services/api/fixtures/demo/trip1-v2/photos/d1-03.jpg"),
  ]);
  await page.waitForURL("**/director?**", { timeout: 60_000 });

  await expect(page.getByText(/I've looked through all 3/)).toBeVisible({ timeout: 210_000 });
  const storyAnswer = page.getByRole("button", { name: /^Yes,/ });
  await expect(storyAnswer).toBeVisible({ timeout: 30_000 });
  await storyAnswer.click();
  await expect(page.locator("[data-face-preview='true'] img").first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => {
    const changes: { target: string; previous: string; current: string }[] = [];
    const pathOf = (value: string) => {
      const match = /url\(["']?(.*?)["']?\)/.exec(value);
      try { return new URL(match?.[1] ?? value, location.href).pathname; } catch { return value; }
    };
    (window as any).__chatSignedPhotoChanges = changes;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const previous = record.attributeName === "src" ? record.oldValue ?? "" : record.oldValue ?? "";
        const current = record.attributeName === "src" ? (record.target as HTMLImageElement).getAttribute("src") ?? "" : (record.target as HTMLElement).style.backgroundImage;
        if (previous !== current && previous && current && pathOf(previous) === pathOf(current)) changes.push({ target: record.attributeName ?? "style", previous, current });
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["src", "style"] });
    (window as any).__chatSignedPhotoObserver = observer;
  });
  await page.waitForTimeout(30_000);
  const changes = await page.evaluate(() => {
    (window as any).__chatSignedPhotoObserver.disconnect();
    return (window as any).__chatSignedPhotoChanges as { target: string; previous: string; current: string }[];
  });
  expect(changes).toEqual([]);
});
