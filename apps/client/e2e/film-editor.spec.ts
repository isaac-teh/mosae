import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const screenshots = path.resolve(process.cwd(), "docs/design/screens-editor");

async function capture(page: Page, name: string) {
  await page.screenshot({ path: path.join(screenshots, name), fullPage: false });
}

test("opens a saved film in the editor, edits it, restores the saved revision, and renders", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir(screenshots, { recursive: true });
  await page.goto("/save-film?filmId=demo-film&directorChat=true&repository=fixture");
  await expect(page.getByText("Saved to your films")).toBeVisible();
  await page.getByRole("button", { name: "Edit film" }).click();
  await expect(page).toHaveURL(/\/editor\?/);
  await expect(page.getByRole("button", { name: "Select clip clip-1" })).toBeVisible();
  await capture(page, "editor-e2e-01-open.png");

  for (const name of ["Swap", "Trim", "Move"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Music", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add clip", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Select clip clip-1" }).click();
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace", exact: true })).toBeVisible();
  const endHandle = page.getByRole("button", { name: "Trim end of clip clip-1" });
  const handleBounds = await endHandle.boundingBox();
  if (!handleBounds) throw new Error("Selected clip has no trim handle");
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBounds.x + handleBounds.width / 2 + 40, handleBounds.y + handleBounds.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText(/0:\d{2} \/ 0:\d{2}/)).toBeVisible();
  await capture(page, "editor-e2e-04-trimmed.png");

  await page.getByRole("button", { name: "Select clip collage-1" }).click();
  await expect(page.getByRole("button", { name: "Layout", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  const tornPaper = page.getByRole("button", { name: "Layout Torn paper mosaic" });
  if (await tornPaper.count()) {
    await tornPaper.click();
    await expect(tornPaper).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByRole("img", { name: "Photo 1 thumbnail" })).toBeVisible();
  await capture(page, "editor-e2e-05-collage-layout.png");

  await page.locator('[aria-label="Close collage"]').click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await capture(page, "editor-e2e-06-undo.png");
  await page.reload();
  await expect(page.getByText("Edit film")).toBeVisible();
  await expect(page.getByRole("button", { name: "Select clip collage-1" })).toBeVisible();
  await page.getByRole("button", { name: "Select clip collage-1" }).click();
  await expect(page.getByRole("button", { name: "Layout", exact: true })).toBeVisible();
  await capture(page, "editor-e2e-07-reloaded-saved-revision.png");
  await page.locator('[aria-label="Close collage"]').click();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Ready")).toBeVisible({ timeout: 10_000 });
  const download = page.getByRole("button", { name: "Download rendered film" });
  await expect(download).toBeVisible();
  await capture(page, "editor-e2e-08-render-ready.png");
  const beforeDownloadUrl = page.url();
  const [downloadFile] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(downloadFile.suggestedFilename()).toMatch(/\.mp4$/);
  expect(page.url()).toBe(beforeDownloadUrl);
});

test("opens Ask from a change request URL", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/editor?projectId=fixture&planId=demo&generationId=demo-film&repository=fixture&request=Make%20it%20shorter");
  await expect(page.getByText("Edit film")).toBeVisible();
  await expect(page.getByText("Ask for an edit")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ask for an edit" })).toHaveValue("Make it shorter");
  await capture(page, "editor-e2e-09-ask-prefilled.png");
});

test("shows one aligned timeline on mobile and desktop", async ({ page }) => {
  const passiveTouchWarnings: string[] = [];
  page.on("console", (message) => {
    if (/passive event listener|preventDefault\(\).*passive/i.test(message.text())) passiveTouchWarnings.push(message.text());
  });
  await mkdir(screenshots, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture");
  const timeline = page.getByLabel("Unified timeline");
  await expect(timeline).toBeVisible();
  await expect(timeline.locator(".." )).toHaveCSS("touch-action", "pan-x");
  await expect(page.getByLabel("Timeline ruler tick 2 seconds")).toBeVisible();
  await expect(page.getByRole("button", { name: "Select clip clip-1" })).toBeVisible();
  await page.getByRole("button", { name: "Open soundtrack picker" }).click();
  await page.getByRole("button", { name: /Preview / }).first().click();
  await page.getByRole("button", { name: "Confirm soundtrack" }).click();
  await expect(page.getByRole("button", { name: /Music track/ })).toBeVisible();
  await page.getByRole("button", { name: /Music track/ }).click();
  await expect(page.getByRole("button", { name: "Volume", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close soundtrack" })).toHaveCount(0);
  await page.getByRole("button", { name: "Zoom in timeline" }).click();
  await expect(page.getByLabel("Timeline zoom 44 pixels per second")).toBeVisible();
  await page.getByRole("button", { name: "Zoom out timeline" }).click();
  await expect(page.getByLabel("Timeline zoom 40 pixels per second")).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, "timeline-unified-390x844.png"), fullPage: false, scale: "css" });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await expect(page.getByLabel("Unified timeline")).toBeVisible();
  await page.getByRole("button", { name: "Open soundtrack picker" }).click();
  await page.getByRole("button", { name: /Preview / }).first().click();
  await page.getByRole("button", { name: "Confirm soundtrack" }).click();
  await expect(page.getByRole("button", { name: /Music track/ })).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, "timeline-unified-1280x800.png"), fullPage: false, scale: "css" });
  expect(passiveTouchWarnings).toEqual([]);
});
