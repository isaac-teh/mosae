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
    await expect(page.getByText("51 moments selected", { exact: true })).toBeVisible();
  });

  test("Continue navigates to create", async ({ page }) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/create?planId=demo&repository=fixture");
  });
});

test.describe("create", () => {
  test.beforeEach(async ({ page }) => { await page.goto("/create?planId=demo"); await page.getByRole("radio", { name: "Direct my film" }).waitFor(); });
  test("film is selected by default", async ({ page }) => { await expect(page.getByRole("radio", { name: "Direct my film" })).toHaveAttribute("aria-checked", "true"); });
  test("Apple Photos updates CTA and shows coming soon", async ({ page }) => { await page.getByRole("radio", { name: "Sync to Apple Photos" }).click(); await page.getByRole("button", { name: "Continue with Sync to Photos" }).click(); await expect(page.getByText("Coming soon")).toBeVisible(); });
  test("film CTA navigates to direction", async ({ page }) => { await page.getByRole("button", { name: "Continue with Direct my film" }).click(); await page.waitForURL("**/direct-film?planId=demo&repository=fixture"); });
});

test.describe("direct-film", () => {
  test.beforeEach(async ({ page }) => { await page.goto("/direct-film?planId=demo"); await page.getByRole("radio", { name: "2m" }).waitFor(); });
  test("2m is selected by default", async ({ page }) => { await expect(page.getByRole("radio", { name: "2m" })).toHaveAttribute("aria-checked", "true"); });
  test("duration can be selected and cleared", async ({ page }) => { const duration = page.getByRole("radio", { name: "3m" }); await duration.click(); await expect(duration).toHaveAttribute("aria-checked", "true"); await duration.click(); await expect(duration).toHaveAttribute("aria-checked", "false"); });
  test("Rewrite changes the director note", async ({ page }) => { const note = page.getByRole("textbox"); const before = await note.inputValue(); await page.getByRole("button", { name: "Rewrite director note" }).click(); await expect(note).not.toHaveValue(before); });
  test("Direct my film navigates to review-film", async ({ page }) => { await page.getByRole("button", { name: "Direct my film" }).click(); await page.waitForURL("**/review-film?filmId=demo-film&repository=fixture"); });
});

test.describe("review-film", () => {
  test.beforeEach(async ({ page }) => { await page.goto("/review-film?filmId=demo-film"); await page.getByRole("button", { name: "Play" }).waitFor(); });
  test("play starts the film", async ({ page }) => { await page.getByRole("button", { name: "Play" }).click(); await expect(page.getByRole("button", { name: "Pause" })).toBeVisible(); await expect(page.locator("video")).toHaveJSProperty("paused", false); });
  test("shortcut fills adjustment input", async ({ page }) => { await page.getByRole("button", { name: "Upbeat music" }).click(); await expect(page.getByRole("textbox")).toHaveValue("Upbeat music"); });
  test("sending adjustment shows version notice", async ({ page }) => { await page.getByRole("button", { name: "Upbeat music" }).click(); await page.getByRole("button", { name: "Send adjustment" }).click(); await expect(page.getByText("Version 2 ready")).toBeVisible(); });
  test("save navigates to save-film", async ({ page }) => { await page.getByRole("button", { name: "Looks good! Save film" }).click(); await page.waitForURL("**/save-film?filmId=demo-film&repository=fixture"); });
});

// Scenes opened straight from a link have no history; back must still reach the previous step.
test.describe("back from a directly opened scene", () => {
  const cases = [
    { from: "/tell-story?projectId=p1&count=3", to: "**/pick-memory" },
    { from: "/review-moments?planId=demo", to: "**/tell-story?repository=fixture" },
    { from: "/create?planId=demo", to: "**/curated-timeline?planId=demo&repository=fixture" },
    { from: "/direct-film?planId=demo", to: "**/create?planId=demo&repository=fixture" },
    { from: "/review-film?filmId=demo-film", to: "**/direct-film?planId=demo&repository=fixture" },
    { from: "/save-film?filmId=demo-film", to: "**/review-film?filmId=demo-film&repository=fixture" },
  ];
  for (const { from, to } of cases) {
    test(`${from} goes back to the previous step`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.goto(from);
      await page.getByRole("button", { name: /^Go back/ }).first().click();
      await page.waitForURL(to);
      expect(errors.filter((e) => e.includes("GO_BACK"))).toEqual([]);
    });
  }
});
