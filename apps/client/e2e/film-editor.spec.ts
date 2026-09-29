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
  await page.getByRole("button", { name: "Still editable anytime" }).click();
  await expect(page.getByText("Edit film")).toBeVisible();
  await expect(page.getByRole("button", { name: "Select clip clip-1" })).toBeVisible();
  await capture(page, "editor-e2e-01-open.png");

  await page.getByRole("button", { name: "Select clip clip-3" }).click();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await page.getByRole("button", { name: "Drop clip at position 1" }).click();
  await expect(page.getByRole("button", { name: "Select clip clip-3" })).toHaveAttribute("aria-label", "Select clip clip-3");
  await capture(page, "editor-e2e-02-moved.png");

  await page.getByRole("button", { name: "Select clip clip-3" }).click();
  await page.getByRole("button", { name: "Swap" }).click();
  await page.getByRole("button", { name: "Use alternative fixture-alt" }).click();
  await capture(page, "editor-e2e-03-swapped.png");

  await page.getByRole("button", { name: "Select clip clip-1" }).click();
  await page.getByRole("button", { name: "Trim" }).click();
  await page.getByRole("button", { name: "Photo duration 4 seconds" }).click();
  await expect(page.getByRole("button", { name: "Photo duration 4 seconds" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("0:03 / 0:23", { exact: true })).toBeVisible();
  await page.locator('[aria-label="Close trim"]').click();
  await capture(page, "editor-e2e-04-trimmed.png");

  await page.getByRole("button", { name: "Select clip collage-1" }).click();
  const pageTurn = page.getByRole("button", { name: "Motion Page turn" });
  await pageTurn.click();
  await expect(pageTurn).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("img", { name: "Photo 1 thumbnail" })).toBeVisible();
  await capture(page, "editor-e2e-05-collage-motion.png");

  await page.locator('[aria-label="Close collage"]').click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await capture(page, "editor-e2e-06-undo.png");
  await page.reload();
  await expect(page.getByText("Edit film")).toBeVisible();
  await expect(page.getByRole("button", { name: "Select clip collage-1" })).toBeVisible();
  await page.getByRole("button", { name: "Select clip collage-1" }).click();
  await expect(page.getByRole("button", { name: "Motion Page turn" })).toHaveAttribute("aria-pressed", "true");
  await capture(page, "editor-e2e-07-reloaded-saved-revision.png");
  await page.locator('[aria-label="Close collage"]').click();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Ready")).toBeVisible({ timeout: 10_000 });
  const download = page.getByRole("button", { name: "Download rendered film" });
  await expect(download).toBeVisible();
  await capture(page, "editor-e2e-08-render-ready.png");
  const downloadPage = await Promise.all([page.waitForEvent("popup"), download.click()]).then(([popup]) => popup);
  await expect.poll(() => downloadPage.url()).toContain("/film");
  await downloadPage.close();
});

test("opens Ask from a change request URL", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/editor?projectId=fixture&planId=demo&generationId=demo-film&repository=fixture&request=Make%20it%20shorter");
  await expect(page.getByText("Edit film")).toBeVisible();
  await expect(page.getByText("Ask for an edit")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ask for an edit" })).toHaveValue("Make it shorter");
  await capture(page, "editor-e2e-09-ask-prefilled.png");
});
