import { expect, test } from "@playwright/test";

test("chat preview opens and closes fullscreen, then seeks", async ({ page }) => {
  await page.goto("/director?repository=fixture&projectId=fixture");
  await expect(page.getByRole("heading", { name: "Film ready" })).toBeVisible();
  const preview = page.locator(".mosae-editor-preview");
  await expect(preview).toBeVisible();
  const fullscreen = page.getByRole("button", { name: "Fullscreen" });
  await expect(fullscreen).toBeVisible();
  await fullscreen.click();

  const close = page.getByRole("button", { name: "Close fullscreen" });
  await expect(close).toBeVisible();
  const overlay = await preview.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      fixed: getComputedStyle(element).position === "fixed",
      bounds: [Math.round(rect.width), Math.round(rect.height)],
      viewport: [window.innerWidth, window.innerHeight],
      overflow: document.body.style.overflow,
    };
  });
  expect(overlay.fixed).toBe(true);
  expect(overlay.bounds).toEqual(overlay.viewport);
  expect(overlay.overflow).toBe("hidden");

  const slider = page.getByRole("slider", { name: "Film progress" });
  const before = Number(await slider.getAttribute("aria-valuenow"));
  const bounds = await slider.boundingBox();
  if (!bounds) throw new Error("Film progress bar is not laid out");
  await page.mouse.click(bounds.x + bounds.width * 0.7, bounds.y + bounds.height / 2);
  await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeGreaterThan(before);

  await close.click();
  await expect(close).toHaveCount(0);
  expect(await page.locator("body").evaluate((body) => (body as HTMLElement).style.overflow)).toBe("");
});

test("chat preview still toggles playback from a mobile touch", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("chromium-") && testInfo.project.name !== "chromium-mobile");
  await page.goto("/director?repository=fixture&projectId=fixture");
  await expect(page.getByRole("heading", { name: "Film ready" })).toBeVisible();
  const play = page.getByRole("button", { name: "Play preview" });
  await play.scrollIntoViewIfNeeded();
  const bounds = await play.boundingBox();
  if (!bounds) throw new Error("Film preview surface is not laid out");
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByRole("button", { name: "Pause preview" })).toBeVisible();
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByRole("button", { name: "Play preview" })).toBeVisible();
});
