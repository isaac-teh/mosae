import { expect, test } from "@playwright/test";

test("walks from story intent to a downloaded film", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/tell-story?projectId=p1&count=3");
  await page.getByRole("textbox").fill("Our first family trip to Japan.");
  await page.getByRole("button", { name: "Find the moments" }).click();

  await page.waitForURL("**/review-moments?planId=demo");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL("**/curated-timeline?planId=demo");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL("**/create?planId=demo");
  await expect(page.getByRole("radio", { name: "Direct my film" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Continue with Direct my film" }).click();

  await page.waitForURL("**/direct-film?planId=demo");
  await page.getByRole("button", { name: "Direct my film" }).click();

  await page.waitForURL("**/review-film?filmId=demo-film");
  await page.getByRole("button", { name: "Upbeat music" }).click();
  await page.getByRole("button", { name: "Send adjustment" }).click();
  await expect(page.getByText("Version 2 ready")).toBeVisible();
  await page.getByRole("button", { name: "Looks good! Save film" }).click();

  await page.waitForURL("**/save-film?filmId=demo-film");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("Mei's 7th Birthday in Japan.mp4");

  expect(errors).toEqual([]);
});
