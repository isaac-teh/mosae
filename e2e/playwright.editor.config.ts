import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../apps/client/e2e",
  testMatch: ["timeline-trim.spec.ts", "director-history.spec.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:18732",
    viewport: { width: 412, height: 870 },
    deviceScaleFactor: 1,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 412, height: 870 } } },
    { name: "webkit-iphone-14", use: { ...devices["iPhone 14"], viewport: { width: 412, height: 870 } } },
  ],
});
