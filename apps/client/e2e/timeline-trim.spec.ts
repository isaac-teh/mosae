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

test("editor playback controls sit beside the time display", async ({ page }, testInfo) => {
  await mkdir(path.resolve(process.cwd(), "docs/design/screens-editor-batch-1"), { recursive: true });
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture");
  await expect(page.getByRole("button", { name: "Play film" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fullscreen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play preview" })).toHaveCount(0);
  for (const name of ["Swap", "Trim", "Move"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  for (const name of ["Remove", "Add", "Ask"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.screenshot({ path: path.resolve(process.cwd(), "docs/design/screens-editor-batch-1", testInfo.project.name === "webkit-iphone-14" ? "e2-editor-current-webkit.png" : "e2-editor-current.png"), scale: "css" });
});
