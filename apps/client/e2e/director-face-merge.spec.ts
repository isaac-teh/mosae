import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test("asks before merging a repeated family answer and keeps the exchange in history", async ({ page }, testInfo) => {
  const screenshots = path.resolve("docs/design/screens-face-merge");
  await mkdir(screenshots, { recursive: true });
  await page.goto("/director?repository=fixture&projectId=face-merge-fixture");
  await expect(page.getByRole("button", { name: "Yes, our Japan trip" })).toBeVisible();
  await page.getByRole("button", { name: "Yes, our Japan trip" }).click();
  await expect(page.getByText("One person appears in 4 moments. Who is this?")).toBeVisible();
  await page.getByRole("button", { name: "My daughter" }).click();
  await expect(page.getByText("One person appears in 3 moments. Who is this?")).toBeVisible();
  await page.getByRole("button", { name: "My daughter" }).click();
  await expect(page.getByText("Same daughter as before?")).toBeVisible();
  await expect(page.getByRole("img", { name: "Previously identified person 1" })).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, `01-follow-up-${testInfo.project.name}.png`) });
  await page.getByRole("button", { name: "Yes, same person" }).click();
  await expect(page.getByText("Yes, same person")).toBeVisible();
  await expect(page.getByText("Same daughter as before?")).toHaveCount(1);
  await expect(page.getByText("No, another daughter")).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshots, `02-merged-history-${testInfo.project.name}.png`) });
});

test("keeps two face groups separate when the user says they are different people", async ({ page }, testInfo) => {
  const screenshots = path.resolve("docs/design/screens-face-merge");
  await mkdir(screenshots, { recursive: true });
  await page.goto("/director?repository=fixture&projectId=face-merge-fixture");
  await page.getByRole("button", { name: "Yes, our Japan trip" }).click();
  await page.getByText("One person appears in 4 moments. Who is this?").waitFor();
  await page.getByRole("button", { name: "My daughter" }).click();
  await page.getByText("One person appears in 3 moments. Who is this?").waitFor();
  await page.getByRole("button", { name: "My daughter" }).click();
  await expect(page.getByText("Same daughter as before?")).toBeVisible();
  await page.getByRole("button", { name: "No, another daughter" }).click();
  await expect(page.getByText("No, another daughter", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "No, another daughter" })).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshots, `03-kept-separate-${testInfo.project.name}.png`) });
});
