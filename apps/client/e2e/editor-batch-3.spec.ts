import { expect, test } from "@playwright/test";

const editorUrl = "/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture";

test("editor mobile add, grid, seek, collage label and deep-link back flow", async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.getByLabel("Unified timeline")).toBeVisible();
  await page.getByRole("button", { name: "Select clip clip-1" }).click();
  const add = page.getByRole("button", { name: "Add clip" });
  await expect(add).toBeVisible();
  const before = await add.boundingBox();
  const selectedEndHandle = await page.getByLabel("Trim end of clip clip-1").boundingBox();
  expect(before && selectedEndHandle).toBeTruthy();
  expect(before!.x + before!.width <= selectedEndHandle!.x || selectedEndHandle!.x + selectedEndHandle!.width <= before!.x || before!.y + before!.height <= selectedEndHandle!.y || selectedEndHandle!.y + selectedEndHandle!.height <= before!.y).toBe(true);
  const musicRow = page.getByLabel("Open soundtrack picker");
  const musicBounds = await musicRow.boundingBox();
  expect(before && musicBounds).toBeTruthy();
  expect(before!.y).toBeGreaterThan(musicBounds!.y + musicBounds!.height);
  await page.getByLabel("Unified timeline").evaluate(node => { node.scrollLeft = node.scrollWidth; node.dispatchEvent(new Event("scroll", { bubbles: true })); });
  await expect(add).toBeVisible();
  expect(await add.boundingBox()).toMatchObject({ x: before?.x, y: before?.y });

  await page.getByRole("button", { name: "Add clip" }).click();
  await expect(page.getByText("Add a moment")).toBeVisible();
  const tile = page.getByRole("button", { name: /^Add (?!clip$)/ }).first();
  await expect(tile).toBeVisible();
  await expect(page.getByLabel("In film").first()).toBeVisible();
  expect(await tile.evaluate(node => getComputedStyle(node).aspectRatio)).toBe("1 / 1");
  const accessibleName = await tile.getAttribute("aria-label");
  expect(accessibleName).toMatch(/^Add /);
  expect(await tile.innerText()).toBe("");
  await tile.click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mosae:fixture-editor:fixture/demo-film") ?? "{}").ops?.at(-1)?.afterClipId)).toBe("clip-1");

  await page.getByRole("button", { name: "Open soundtrack picker" }).click();
  await page.getByRole("button", { name: /^Preview / }).first().click();
  const seek = page.getByRole("slider", { name: "Seek soundtrack preview" });
  await expect(seek).toBeVisible();
  await seek.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText(/0:0[1-9] \/ /)).toBeVisible();
  await page.getByLabel("Close soundtrack").click();

  await page.getByRole("button", { name: "Select clip collage-1" }).click();
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await page.getByRole("button", { name: "Increase number of photos" }).click();
  await page.getByLabel("Close collage").click();
  await page.getByLabel("Select collage cell empty:collage-1:5").click();
  await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("removed collage photo loses its in-film badge in the Add photo picker", async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.getByLabel("Unified timeline")).toBeVisible();
  await page.getByRole("button", { name: "Select clip collage-1" }).click();
  const photo = page.locator('[data-collage-cell="collage-1:slot-1"]').locator("xpath=..").locator("[data-collage-media]");
  await expect(photo).toBeVisible();
  const photoSource = await photo.getAttribute("src");
  await page.locator('[data-collage-cell="collage-1:slot-1"]').click({ force: true });
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  const emptyCell = page.getByRole("button", { name: "Select collage cell slot-1" });
  await expect(emptyCell).toBeVisible();
  await emptyCell.click({ force: true });
  await page.getByRole("button", { name: "Add photo" }).click();
  await expect(page.getByText("Replace cell", { exact: true })).toBeVisible();
  const removedPhotoChoice = page.getByRole("button", { name: /^Replace with / }).filter({ has: page.locator(`img[src="${photoSource}"]`) });
  await expect(removedPhotoChoice).toBeVisible();
  await expect(removedPhotoChoice.getByLabel("In film")).toHaveCount(0);
});
