import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test("shows repeated poster frames for a video timeline slot without rendering video", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 870 });
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture");
  const slot = page.getByRole("button", { name: "Select clip clip-1" });
  await expect(slot).toBeVisible();
  const frames = slot.getByLabel("Video thumbnail frame");
  await expect(frames).toHaveCount(3);
  const sources = await frames.evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
  expect(new Set(sources).size).toBe(1);
  await expect(slot.getByLabel("Video clip badge")).toHaveText("VIDEO");
  await expect(slot.locator("video")).toHaveCount(0);
  await mkdir(path.resolve("docs/design/screens-editor-batch-2"), { recursive: true });
  await page.screenshot({ path: path.resolve("docs/design/screens-editor-batch-2/video-slot-thumb.png"), fullPage: false });
});
