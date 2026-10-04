import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("touch taps play on the opening frame and pause on a collage frame", async ({ page }) => {
  await page.goto("/director?projectId=fixture&repository=fixture");
  await expect(page.getByRole("heading", { name: "Film ready" })).toBeVisible();
  const preview = page.locator(".mosae-editor-preview");
  await expect(preview).toBeVisible();
  const surface = page.getByRole("button", { name: "Play preview" });
  await surface.scrollIntoViewIfNeeded();
  const opening = await surface.boundingBox();
  if (!opening) throw new Error("opening film frame is not visible");
  await page.touchscreen.tap(opening.x + opening.width / 2, opening.y + opening.height / 2);
  await expect(page.getByRole("button", { name: "Pause preview" })).toBeVisible();
  await expect(page.getByTestId("film-preview-play-overlay")).toBeHidden();
  await expect.poll(async () => Number(await page.getByRole("button", { name: "Pause preview" }).getAttribute("data-current-time"))).toBeGreaterThan(0.2);

  await expect.poll(async () => Number(await page.getByRole("button", { name: "Pause preview" }).getAttribute("data-current-time")), { timeout: 10_000 }).toBeGreaterThan(3.1);
  const collageFrame = await page.getByRole("button", { name: "Pause preview" }).boundingBox();
  if (!collageFrame) throw new Error("collage frame is not visible");
  await page.touchscreen.tap(collageFrame.x + collageFrame.width / 2, collageFrame.y + collageFrame.height / 2);
  await expect(page.getByRole("button", { name: "Play preview" })).toBeVisible();
  await expect(page.getByTestId("film-preview-play-overlay")).toBeVisible();
});
