import { expect, test } from "@playwright/test";

test("chat preview fullscreen covers the viewport and touch seeking updates the film", async ({ page }, testInfo) => {
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
    const player = element.querySelector(".__remotion-player");
    const playerRect = player?.getBoundingClientRect();
    return {
      parentIsBody: element.parentElement === document.body,
      nativeFullscreen: document.fullscreenElement === element,
      fixed: getComputedStyle(element).position === "fixed",
      bounds: [Math.round(rect.width), Math.round(rect.height)],
      viewport: [window.innerWidth, window.innerHeight],
      playerVisible: Boolean(playerRect && playerRect.width > 0 && playerRect.height > 0 && getComputedStyle(player!).visibility !== "hidden"),
      overflow: document.body.style.overflow,
    };
  });
  expect(overlay.parentIsBody || overlay.nativeFullscreen).toBe(true);
  expect(overlay.fixed).toBe(true);
  expect(overlay.bounds).toEqual(overlay.viewport);
  expect(overlay.playerVisible).toBe(true);
  expect(overlay.overflow).toBe("hidden");

  const slider = page.getByRole("slider", { name: "Film progress" });
  const bounds = await slider.boundingBox();
  if (!bounds) throw new Error("Film progress bar is not laid out");
  const target = bounds.x + bounds.width * 0.75;
  if (testInfo.project.use.hasTouch) {
    await page.touchscreen.tap(target, bounds.y + bounds.height / 2);
  } else {
    await page.mouse.click(target, bounds.y + bounds.height / 2);
  }
  const duration = Number(await slider.getAttribute("aria-valuemax"));
  await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeGreaterThan(duration * 0.65);
  await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeLessThan(duration * 0.85);

  const timeAfterSeek = Number(await slider.getAttribute("aria-valuenow"));
  const play = page.getByRole("button", { name: "Play preview" });
  if (await play.isVisible()) await play.click();
  await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeGreaterThan(timeAfterSeek);

  await close.click();
  await expect(close).toHaveCount(0);
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((element) => element.parentElement !== document.body)).toBe(true);
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

test("chat preview controls stay inside the rounded card bounds", async ({ page }) => {
  await page.goto("/director?repository=fixture&projectId=fixture");
  await expect(page.getByRole("heading", { name: "Film ready" })).toBeVisible();
  const preview = page.locator(".mosae-editor-preview");
  const controls = [
    page.getByRole("slider", { name: "Film progress" }),
    preview.getByTestId("film-current-time"),
    preview.getByTestId("film-duration"),
    page.getByRole("button", { name: "Fullscreen" }),
  ];
  const card = await preview.boundingBox();
  if (!card) throw new Error("Film preview card is not laid out");
  for (const control of controls) {
    const box = await control.boundingBox();
    if (!box) throw new Error("Chat preview control is not laid out");
    expect(box.x).toBeGreaterThanOrEqual(card.x);
    expect(box.y).toBeGreaterThanOrEqual(card.y);
    expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
    expect(box.y + box.height).toBeLessThanOrEqual(card.y + card.height - 8);
  }
});
