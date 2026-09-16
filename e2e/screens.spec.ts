import { expect, test } from "@playwright/test";

test.describe("review-moments", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/review-moments?planId=demo");
    // Wait for fonts and images to load
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined))));
    await page.waitForTimeout(300);
  });

  test("unchecking birthday card dims photo and sets aria-checked=false", async ({ page }) => {
    const card = page.getByRole("checkbox", { name: "Select Mai's 7th Birthday Song" });
    await expect(card).toHaveAttribute("aria-checked", "true");
    await card.click();
    await expect(card).toHaveAttribute("aria-checked", "false");
  });

  test("re-checking restores aria-checked=true", async ({ page }) => {
    const card = page.getByRole("checkbox", { name: "Select Mai's 7th Birthday Song" });
    await card.click();
    await expect(card).toHaveAttribute("aria-checked", "false");
    await card.click();
    await expect(card).toHaveAttribute("aria-checked", "true");
  });

  test("Continue button navigates to curated-timeline", async ({ page }) => {
    const continueBtn = page.getByRole("button", { name: "Continue" });
    await continueBtn.click();
    await page.waitForURL("**/curated-timeline**");
    expect(page.url()).toContain("/curated-timeline?planId=demo");
  });

  test("Add more button navigates to pick-memory", async ({ page }) => {
    const addMore = page.getByRole("button", { name: "Add more" });
    await addMore.click();
    await page.waitForURL("**/pick-memory**");
    expect(page.url()).toContain("/pick-memory");
  });

  test("Add from other photos card navigates to pick-memory", async ({ page }) => {
    const addCard = page.getByRole("button", { name: /Add from \d+ other photos/ });
    await addCard.click();
    await page.waitForURL("**/pick-memory**");
    expect(page.url()).toContain("/pick-memory");
  });
});

test.describe("curated-timeline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/curated-timeline?planId=demo");
    await page.getByText("Want to change the moments").waitFor();
  });

  test("a suggestion fills the update input", async ({ page }) => {
    await page.getByRole("button", { name: "Show more of the food we tried" }).click();
    await expect(page.getByRole("textbox")).toHaveValue("Show more of the food we tried");
  });

  test("update clears the input", async ({ page }) => {
    await page.getByRole("textbox").fill("More birthday photos");
    await page.getByRole("button", { name: "Update moments" }).click();
    await expect(page.getByRole("textbox")).toHaveValue("");
  });

  test("deselecting lowers the selected count", async ({ page }) => {
    await page.getByRole("checkbox", { name: "Select Mai's 7th Birthday Song" }).click();
    await expect(page.getByText("51 moments selected")).toBeVisible();
  });

  test("Continue navigates to create", async ({ page }) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/create?planId=demo");
  });
});
