import { expect, test, devices } from "@playwright/test";

test.use({ ...devices["iPhone 14"], browserName: "webkit" });

test("iPhone fullscreen uses a fixed overlay and keeps tap-to-seek available", async ({ page }) => {
  await page.goto("/director?repository=fixture&projectId=fixture");
  await expect(page.getByRole("heading", { name: "Film ready" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fullscreen" })).toBeVisible();
  await page.getByRole("button", { name: "Fullscreen" }).click();

  const close = page.getByRole("button", { name: "Close fullscreen" });
  await expect(close).toBeVisible();
  const overlay = await close.evaluate((button) => {
    const root = button.parentElement!;
    const rect = root.getBoundingClientRect();
    return {
      parentIsBody: root.parentElement === document.body,
      fixed: getComputedStyle(root).position === "fixed",
      bounds: [Math.round(rect.width), Math.round(rect.height)],
      viewport: [window.innerWidth, window.innerHeight],
      overflow: document.body.style.overflow,
    };
  });
  expect(overlay.parentIsBody).toBe(true);
  expect(overlay.fixed).toBe(true);
  expect(overlay.bounds).toEqual(overlay.viewport);
  expect(overlay.overflow).toBe("hidden");

  const slider = page.getByRole("slider", { name: "Film progress" });
  const before = Number(await slider.getAttribute("aria-valuenow"));
  const bounds = await slider.boundingBox();
  if (!bounds) throw new Error("Film progress bar is not laid out");
  await page.mouse.click(bounds.x + bounds.width * 0.7, bounds.y + bounds.height / 2);
  await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  await page.screenshot({ path: "docs/design/screens-pt-feedback-1/pt-08-ios-fullscreen.png" });

  await close.click();
  await expect(close).toHaveCount(0);
  expect(await page.locator("body").evaluate((body) => (body as HTMLElement).style.overflow)).toBe("");
});
