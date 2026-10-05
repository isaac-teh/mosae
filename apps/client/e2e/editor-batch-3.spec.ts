import { expect, test } from "@playwright/test";

const editorUrl = "/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture";

test("editor mobile add, grid, seek, collage label and deep-link back flow", async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.getByLabel("Unified timeline")).toBeVisible();
  await page.getByRole("button", { name: "Select clip clip-1" }).click();
  const add = page.getByRole("button", { name: "Add clip" });
  await expect(add).toBeVisible();
  const before = await add.boundingBox();
  await page.getByLabel("Unified timeline").evaluate(node => { node.scrollLeft = node.scrollWidth; node.dispatchEvent(new Event("scroll", { bubbles: true })); });
  await expect(add).toBeVisible();
  expect(await add.boundingBox()).toMatchObject({ x: before?.x, y: before?.y });

  await page.getByRole("button", { name: "Add clip" }).click();
  await expect(page.getByText("Add a moment")).toBeVisible();
  const tile = page.getByRole("button", { name: /^Add (?!clip$)/ }).first();
  await expect(tile).toBeVisible();
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
