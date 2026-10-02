import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test("dragging a selected timeline edge changes film length and supports undo/redo", async ({ page }, testInfo) => {
  await mkdir(path.resolve(process.cwd(), "docs/design/screens-editor-batch-2"), { recursive: true });
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
  await page.screenshot({ path: path.resolve(process.cwd(), "docs/design/screens-editor-batch-2", testInfo.project.name === "webkit-iphone-14" ? "e1-slot-trim-handles-webkit.png" : "e1-slot-trim-handles.png"), scale: "css" });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(readDuration).toBe(before);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(readDuration).toBe(before + 1);
});

test("context toolbar follows film, slot and collage selection", async ({ page }, testInfo) => {
  await mkdir(path.resolve(process.cwd(), "docs/design/screens-editor-batch-2"), { recursive: true });
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture");
  await expect(page.getByRole("button", { name: "Play film" })).toBeVisible();
  const screenshot = (name: string) => page.screenshot({ path: path.resolve(process.cwd(), "docs/design/screens-editor-batch-2", `${name}-${testInfo.project.name === "webkit-iphone-14" ? "webkit" : "chromium"}.png`), scale: "css" });
  for (const action of ["Music", "Add", "Ask"]) await expect(page.getByRole("button", { name: action, exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Film progress" })).toHaveCount(0);
  await expect(page.getByText("00:00", { exact: true })).toHaveCount(0);
  await expect(page.getByText("00:23", { exact: true })).toHaveCount(0);
  const preview = page.getByRole("button", { name: "Play preview" });
  await expect(preview).toBeVisible();
  await preview.click();
  await expect(page.getByRole("button", { name: "Pause preview" })).toBeVisible();
  await page.getByRole("button", { name: "Pause preview" }).click();
  await expect(page.getByRole("button", { name: "Play preview" })).toBeVisible();
  await screenshot("toolbar-none");

  await page.getByRole("button", { name: "Select clip clip-1" }).click();
  for (const action of ["Deselect", "Replace", "Duplicate", "Ask", "Delete"]) await expect(page.getByRole("button", { name: action, exact: true })).toBeVisible();
  for (const action of ["Music", "Add"]) await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  await screenshot("toolbar-slot");
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  const duplicate = page.getByRole("button", { name: "Select clip duplicate:clip-1:1" });
  await expect(duplicate).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(duplicate).toHaveCount(0);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Ask for an edit" })).toHaveValue("For this moment: ");
  await page.getByLabel("Close Ask").click();
  await page.getByRole("button", { name: "Deselect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Music", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Select clip collage-1" }).click();
  for (const action of ["Deselect", "Layout", "Motion", "Duplicate", "Delete"]) await expect(page.getByRole("button", { name: action, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toHaveCount(0);
  await screenshot("toolbar-collage");
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await expect(page.getByText("Collage layout")).toBeVisible();
  await expect(page.getByRole("button", { name: "Layout Photo table" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Motion Stack deal" })).toHaveCount(0);
  await page.getByLabel("Close collage").click();
  await page.getByRole("button", { name: "Motion", exact: true }).click();
  await expect(page.getByText("Collage motion")).toBeVisible();
  await expect(page.getByRole("button", { name: "Motion Stack deal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Layout Photo table" })).toHaveCount(0);
});

test("long press reorders a collage as one timeline slot and supports undo", async ({ page }, testInfo) => {
  await mkdir(path.resolve(process.cwd(), "docs/design/screens-editor-batch-2"), { recursive: true });
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture");
  const collage = page.getByRole("button", { name: "Select clip collage-1" });
  await expect(collage).toBeVisible();
  await page.waitForTimeout(250);
  await collage.hover();
  const bounds = await collage.boundingBox();
  if (!bounds) throw new Error("Collage slot has no layout box");
  const startY = bounds.y + bounds.height / 2;
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.move(80, startY, { steps: 8 });
  await expect.poll(() => collage.evaluate((button) => getComputedStyle(button.parentElement!).transform)).not.toBe("none");
  await expect.poll(async () => { const box = await collage.boundingBox(); return box ? Math.abs(box.x + box.width / 2 - 80) : Number.POSITIVE_INFINITY; }).toBeLessThan(4);
  await page.screenshot({ path: path.resolve(process.cwd(), "docs/design/screens-editor-batch-2", testInfo.project.name === "webkit-iphone-14" ? "e4-reorder-collage-webkit.png" : "e4-reorder-collage.png"), scale: "css" });
  await page.mouse.up();
  const contextMenuPrevented = await collage.evaluate((slot) => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    slot.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(contextMenuPrevented).toBe(true);
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
  await page.waitForTimeout(250);
  await clip.hover();
  const bounds = await clip.boundingBox();
  if (!bounds) throw new Error("Timeline slot has no layout box");
  const y = bounds.y + bounds.height / 2;
  await page.mouse.down();
  await page.waitForTimeout(500);
  await expect.poll(() => clip.evaluate((button) => getComputedStyle(button.parentElement!).transform)).not.toBe("none");
  await page.mouse.move(380, y, { steps: 8 });
  const timeline = page.getByLabel("Unified timeline");
  await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.mouse.up();
});

test("collage cells can be cropped, replaced, added, removed, and undone within template limits", async ({ page }, testInfo) => {
  await mkdir(path.resolve(process.cwd(), "docs/design/screens-editor-batch-2"), { recursive: true });
  await page.setViewportSize({ width: 412, height: 870 });
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture");
  const collageSlot = page.getByRole("button", { name: "Select clip collage-1" });
  await expect(collageSlot).toBeVisible();
  await collageSlot.click();
  await page.getByRole("button", { name: "Play preview" }).click();
  await expect(page.getByRole("button", { name: "Pause preview" })).toBeVisible();
  const cell = page.locator('[data-collage-cell="collage-1:slot-1"]');
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(page.getByRole("button", { name: "Play preview" })).toBeVisible();
  await expect(cell).toHaveAttribute("aria-pressed", "true");
  const toolbar = page.getByLabel("Editor tools");
  await expect(toolbar.getByRole("button", { name: "Back" })).toBeVisible();

  const bounds = await cell.boundingBox();
  if (!bounds) throw new Error("Collage cell has no preview bounds");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y + 8, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  const readCropStyle = () => cell.evaluate((overlay) => {
    const media = overlay.parentElement?.querySelector<HTMLElement>("[data-collage-media]");
    return { position: media?.style.objectPosition, transform: media?.style.transform };
  });
  await expect.poll(readCropStyle).not.toMatchObject({ position: "50% 50%" });
  await page.screenshot({ path: path.resolve(process.cwd(), "docs/design/screens-editor-batch-2", testInfo.project.name === "webkit-iphone-14" ? "collage-cell-pan-webkit.png" : "collage-cell-pan-chromium.png"), scale: "css" });

  await toolbar.getByRole("button", { name: "Replace" }).click();
  await expect(page.getByText("Replace cell")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Replace with/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Replace with/ }).first().click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(readCropStyle).toMatchObject({ transform: "scale(1)" });

  await toolbar.getByRole("button", { name: "Back" }).click();
  await toolbar.getByRole("button", { name: "Add cell" }).click();
  await page.getByRole("button", { name: /^Add cell Video clip/ }).click();
  await toolbar.getByRole("button", { name: "Add cell" }).click();
  await expect(page.getByRole("button", { name: /^Add cell Video clip/ })).toBeDisabled();
  await page.getByRole("button", { name: /^Add cell Mai's 7th Birthday Song/ }).click();
  await expect(toolbar.getByRole("button", { name: "Add cell" })).toBeDisabled();
  await expect(page.getByText("This layout holds up to 6 photos")).toBeVisible();

  await page.locator('[data-collage-cell="collage-1:slot-1"]').click();
  await toolbar.getByRole("button", { name: "Remove cell" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.locator('[data-collage-cell="collage-1:slot-1"]').click();
  await toolbar.getByRole("button", { name: "Remove cell" }).click();
  await page.locator('[data-collage-cell="collage-1:slot-2"]').click();
  await toolbar.getByRole("button", { name: "Remove cell" }).click();
  await page.locator('[data-collage-cell="collage-1:slot-3"]').click();
  await expect(toolbar.getByRole("button", { name: "Remove cell" })).toBeDisabled();
  await expect(page.getByText("This layout needs at least 4 photos")).toBeVisible();
  await page.screenshot({ path: path.resolve(process.cwd(), "docs/design/screens-editor-batch-2", testInfo.project.name === "webkit-iphone-14" ? "collage-cell-limits-webkit.png" : "collage-cell-limits-chromium.png"), scale: "css" });
});

test("photo trim drag stays local across 40 pointer steps and video trim can expand from both ends", async ({ page }, testInfo) => {
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture");
  const duration = page.getByText(/^\d+:\d{2} \/ \d+:\d{2}$/);
  const readDuration = async () => {
    const text = await duration.textContent();
    const match = text?.match(/\/ (\d+):(\d{2})$/);
    if (!match) throw new Error(`Could not read total duration from ${text}`);
    return Number(match[1]) * 60 + Number(match[2]);
  };
  await page.getByRole("button", { name: "Select clip clip-3" }).click();
  const photoHandle = page.getByRole("button", { name: "Trim end of clip clip-3" });
  const photoBox = await photoHandle.boundingBox();
  if (!photoBox) throw new Error("Photo trim handle has no layout box");
  if (testInfo.project.name === "chromium") await page.evaluate(() => {
    (window as any).__trimLongTaskMs = 0;
    const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) (window as any).__trimLongTaskMs += entry.duration; });
    observer.observe({ type: "longtask", buffered: true });
    (window as any).__trimLongTaskObserver = observer;
  });
  const startedAt = testInfo.project.name === "chromium" ? await page.evaluate(() => performance.now()) : 0;
  await page.mouse.move(photoBox.x + photoBox.width / 2, photoBox.y + photoBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(photoBox.x + photoBox.width / 2 + 40, photoBox.y + photoBox.height / 2, { steps: 40 });
  await page.mouse.up();
  if (testInfo.project.name === "chromium") {
    const wallMs = await page.evaluate((start) => performance.now() - start, startedAt);
    const longTaskMs = await page.evaluate(() => { (window as any).__trimLongTaskObserver.disconnect(); return (window as any).__trimLongTaskMs; });
    expect(wallMs).toBeLessThan(1000);
    expect(longTaskMs).toBeLessThan(1000);
  }

  const before = await readDuration();
  await page.getByRole("button", { name: "Select clip clip-1" }).click();
  const startHandle = page.getByRole("button", { name: "Trim start of clip clip-1" });
  const startBox = await startHandle.boundingBox();
  if (!startBox) throw new Error("Video start trim handle has no layout box");
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(startBox.x + startBox.width / 2 - 40, startBox.y + startBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(readDuration).toBe(before + 1);
  await page.getByRole("button", { name: "Undo" }).click();
  const endHandle = page.getByRole("button", { name: "Trim end of clip clip-1" });
  const endBox = await endHandle.boundingBox();
  if (!endBox) throw new Error("Video end trim handle has no layout box");
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width / 2 + 40, endBox.y + endBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(readDuration).toBe(before + 1);
});
