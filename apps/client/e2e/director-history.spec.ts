import { expect, test } from "@playwright/test";

test("answered direction keeps the AI question and full suggestion in fixture chat history", async ({ page }) => {
  await page.goto("/director?repository=fixture&projectId=fixture");
  const question = page.getByText(/For a 4-day trip I'd suggest this\./);
  await expect(question).toBeVisible();
  await expect(question).toContainText("Change anything that doesn't feel right.");
  await expect(question).toBeVisible();
  const history = page.getByLabel("Director chat history");
  for (const row of ["Pace: Gentle", "Length: 130 sec", "Focus: Whole family", "Collages: A few", "Motion: Calm"]) await expect(history).toContainText(row);
});
