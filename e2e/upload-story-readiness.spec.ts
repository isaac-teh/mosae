import { expect, test, devices } from "@playwright/test";
import path from "node:path";
import { statSync } from "node:fs";

test.use({ ...devices["Pixel 7"] });

test("throttled three-photo mobile upload reaches the story question", async ({ page }) => {
  test.setTimeout(240_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 150, downloadThroughput: 4 * 1024 * 1024 / 8,
    uploadThroughput: 3 * 1024 * 1024 / 8, connectionType: "cellular4g",
  });
  const photos = ["d1-01.jpg", "d1-02.jpg", "d1-03.jpg"].map(name => path.resolve("services/api/fixtures/demo/trip1-v2/photos", name));
  const inputBytes = photos.reduce((sum, photo) => sum + statSync(photo).size, 0);
  const requestFailures: string[] = [];
  const events: { name: string; at: number; detail?: string }[] = [];
  page.on("requestfailed", request => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  page.on("request", request => { if (/upload-sessions/.test(request.url())) events.push({ name: `${request.method()} ${new URL(request.url()).pathname}`, at: Date.now() }); });
  page.on("console", message => { if (message.text().includes("upload_timing")) events.push({ name: "upload_timing", at: Date.now(), detail: message.text() }); });
  await page.goto("/");
  await page.getByRole("button", { name: /Create a new film/ }).click();
  const tappedAt = Date.now();
  await page.locator('input[type="file"]').setInputFiles(photos);
  await page.waitForURL("**/director?**", { timeout: 60_000 });
  await expect(page.getByText(/I've looked through all 3/)).toBeVisible({ timeout: 210_000 });
  const tapToQuestionMs = Date.now() - tappedAt;
  const closeAt = events.find(event => event.name.endsWith("/close"))?.at;
  const firstUploadNotificationAt = events.find(event => event.name.endsWith("/uploaded"))?.at;
  expect(closeAt).toBeDefined();
  expect(firstUploadNotificationAt).toBeDefined();
  expect(closeAt!).toBeLessThan(firstUploadNotificationAt!);
  console.log(JSON.stringify({ profile: "Pixel 7 Chromium mobile emulation, cellular4g 150ms RTT, 3Mbps up / 4Mbps down", photos: 3, inputBytes, tapToQuestionMs, uploadEvents: events }));
  expect(requestFailures).toEqual([]);
});
