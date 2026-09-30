import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const screenshots = path.resolve(process.cwd(), "docs/design/screens-live");

test("Saved film at phone size shows the finished film and downloads without leaving the screen", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 870 });
  await mkdir(screenshots, { recursive: true });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new DOMException("activation expired", "NotAllowedError"); } });
  });
  await page.goto("/save-film?filmId=demo-film&directorChat=true&repository=fixture");
  await expect(page.getByText("Saved to your films")).toBeVisible();
  await expect(page.getByText("Mei's 7th Birthday in Japan")).toBeVisible();
  const poster = page.getByRole("img", { name: "Film poster" });
  await expect(poster).toBeVisible();
  await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThan(0);
  await expect(page.getByText(/step 6/i)).toHaveCount(0);
  await expect(page.getByText(/sample print/i)).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshots, "saved-film-412x870.png"), fullPage: false, scale: "css" });

  const beforeDownloadUrl = page.url();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.mp4$/);
  expect(page.url()).toBe(beforeDownloadUrl);
});

test("saved project reopens at Film ready from Director chat", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 870 });
  await page.goto("/director?projectId=fixture&repository=fixture");
  await expect(page.getByRole("heading", { name: "Film ready" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open in editor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save film" })).toBeVisible();
});

test("Home includes the demo film and routes it back into its project", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 870 });
  await page.goto("/?repository=fixture");
  await expect(page.getByRole("heading", { name: "Your films" })).toBeVisible();
  await expect(page.getByText("Film ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Mei's 7th Birthday/ }).click();
  await expect(page).toHaveURL(/director\?repository=fixture&projectId=fixture/);
  await expect(page.getByRole("heading", { name: "Film ready" })).toBeVisible();
});

test("production Home without query parameters calls /api/projects, not the fixture repository", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 870 });
  const projectsApiRequests: string[] = [];
  const projectsApiStatuses: number[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname.includes("mosae-api") && url.pathname === "/api/projects") projectsApiRequests.push(request.url());
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname.includes("mosae-api") && url.pathname === "/api/projects") projectsApiStatuses.push(response.status());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your films" })).toBeVisible();
  await expect(page.getByText("Mei's 7th Birthday in Japan")).toHaveCount(0);
  await expect(page.getByText("No films yet. Your first one will live here, and it stays editable.")).toBeVisible();
  await expect.poll(() => projectsApiRequests.length).toBeGreaterThan(0);
  await expect.poll(() => projectsApiStatuses.length).toBeGreaterThan(0);
  expect(projectsApiStatuses).toContain(200);
  expect(page.url()).toBe("https://neural-orbit-388508.web.app/");
});
