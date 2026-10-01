import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test("dragging a selected timeline edge changes film length and supports undo/redo", async ({ page }, testInfo) => {
  await mkdir(path.resolve(process.cwd(), "docs/design/screens-editor-batch-1"), { recursive: true });
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture");
  await expect(page.getByRole("button", { name: "Select clip clip-1" })).toBeVisible();
  await page.setViewportSize({ width: 412, height: 870 });
  await page.getByRole("button", { name: "Select clip clip-1" }).click();
  const handle = page.getByRole("button", { name: "Trim end of clip clip-1" });
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute("aria-pressed", "true");

  const duration = page.getByText(/^\d+:\d{2} \/ \d+:\d{2}$/);
  const readDuration = async () => {
    const text = await duration.textContent();
    const match = text?.match(/\/ (\d+):(\d{2})$/);
    if (!match) throw new Error(`Could not read total film duration from ${text}`);
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const before = await readDuration();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Selected trim handle has no layout box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(readDuration).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.screenshot({ path: path.resolve(process.cwd(), "docs/design/screens-editor-batch-1", testInfo.project.name === "webkit-iphone-14" ? "e1-slot-trim-handles-webkit.png" : "e1-slot-trim-handles.png"), scale: "css" });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(readDuration).toBe(before);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(readDuration).toBe(before + 1);
});

test("editor timeline owns scrubbing and preview taps toggle playback", async ({ page }, testInfo) => {
  await mkdir(path.resolve(process.cwd(), "docs/design/screens-editor-batch-1"), { recursive: true });
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture");
  await expect(page.getByRole("button", { name: "Play film" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Film progress" })).toHaveCount(0);
  await expect(page.getByText("00:00", { exact: true })).toHaveCount(0);
  await expect(page.getByText("00:23", { exact: true })).toHaveCount(0);
  const preview = page.getByRole("button", { name: "Play preview" });
  await expect(preview).toBeVisible();
  await preview.click();
  await expect(page.getByRole("button", { name: "Pause preview" })).toBeVisible();
  await page.getByRole("button", { name: "Pause preview" }).click();
  await expect(page.getByRole("button", { name: "Play preview" })).toBeVisible();
  for (const name of ["Swap", "Trim", "Move"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  for (const name of ["Remove", "Add", "Ask"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.screenshot({ path: path.resolve(process.cwd(), "docs/design/screens-editor-batch-1", testInfo.project.name === "webkit-iphone-14" ? "e2-editor-current-webkit.png" : "e2-editor-current.png"), scale: "css" });
});

test("long press reorders a collage as one timeline slot and supports undo", async ({ page }, testInfo) => {
  await mkdir(path.resolve(process.cwd(), "docs/design/screens-editor-batch-1"), { recursive: true });
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture");
  const collage = page.getByRole("button", { name: "Select clip collage-1" });
  await expect(collage).toBeVisible();
  const bounds = await collage.boundingBox();
  if (!bounds) throw new Error("Collage slot has no layout box");
  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.move(245, startY, { steps: 8 });
  await expect.poll(() => collage.evaluate((button) => getComputedStyle(button.parentElement!).transform)).not.toBe("none");
  await expect.poll(async () => { const box = await collage.boundingBox(); return box ? Math.abs(box.x + box.width / 2 - 245) : Number.POSITIVE_INFINITY; }).toBeLessThan(4);
  await page.screenshot({ path: path.resolve(process.cwd(), "docs/design/screens-editor-batch-1", testInfo.project.name === "webkit-iphone-14" ? "e4-reorder-collage-webkit.png" : "e4-reorder-collage.png"), scale: "css" });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Select clip collage-1" }).first()).toBeVisible();
  const firstTwoIds = async () => (await page.locator('[aria-label^="Select clip "]').evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).slice(0, 2);
  await expect.poll(firstTwoIds).toEqual(["Select clip collage-1", "Select clip clip-1"]);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(firstTwoIds).toEqual(["Select clip clip-1", "Select clip collage-1"]);
});

test("timeline auto-scrolls while a long-pressed slot is held at the edge", async ({ page }) => {
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture");
  const clip = page.getByRole("button", { name: "Select clip collage-1" });
  await expect(clip).toBeVisible();
  const bounds = await clip.boundingBox();
  if (!bounds) throw new Error("Timeline slot has no layout box");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await expect.poll(() => clip.evaluate((button) => getComputedStyle(button.parentElement!).transform)).not.toBe("none");
  await page.mouse.move(380, y, { steps: 8 });
  const timeline = page.getByLabel("Unified timeline");
  await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.mouse.up();
});
