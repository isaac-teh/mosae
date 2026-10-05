import { expect, test } from "@playwright/test";

const projectId = "phone-upload-fixture";
const generationId = "phone-film";
const editorUrl = `/editor?projectId=${projectId}&generationId=${generationId}&repository=api`;
const transitionIn = { kind: "cut", durationSec: 0 };
const timeline = {
  schemaVersion: 2, projectId, mode: "memory", aspect: "9:16", fps: 30, durationSec: 10,
  chapters: [], audioClips: [], captions: [],
  videoClips: [
    { id: "clip-1", source: { kind: "photo", shotId: "shot-1" }, startSec: 0, durationSec: 3, transitionIn },
    { kind: "collage", clipId: "collage-1", startSec: 3, durationSec: 4, transitionIn, spec: {
      layoutId: "photo-table", slots: ["shot-1", "shot-2", "shot-3", "shot-4"].map((shotId, index) => ({ slotId: `slot-${index + 1}`, shotId, kind: "photo" })),
      motionId: "stack-deal", effectId: "vignette", seed: "phone-test", durationSec: 4,
    } },
    { id: "clip-2", source: { kind: "photo", shotId: "shot-2" }, startSec: 7, durationSec: 3, transitionIn },
  ],
};

test("phone upload adds a clip after selection and the collage sheet shares its upload button", async ({ page }) => {
  let uploaded = false;
  await page.route("**/identitytoolkit.googleapis.com/**", route => route.fulfill({ status: 200, json: route.request().url().includes("accounts:lookup")
    ? { users: [{ localId: "phone-upload-test", emailVerified: false, displayName: "", photoUrl: "", providerUserInfo: [], validSince: "0", lastLoginAt: "0", createdAt: "0" }] }
    : { localId: "phone-upload-test", idToken: "test-token", refreshToken: "test-refresh", expiresIn: "3600" } }));
  await page.route("**/securetoken.googleapis.com/**", route => route.fulfill({ status: 200, json: { user_id: "phone-upload-test", id_token: "test-token", refresh_token: "test-refresh", expires_in: "3600", token_type: "Bearer" } }));
  await page.route("**/api/projects/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname.endsWith(`/generations/${generationId}`) && request.method() === "GET") {
      await route.fulfill({ json: { id: generationId, status: "ready", timeline, sources: {}, thumbnails: {}, unusedMedia: uploaded ? [{ shotId: "phoneasset_shot1", kind: "photo", thumbnailUrl: "https://media.test/phone.jpg", previewUrl: "https://media.test/phone.jpg", date: "2026-10-05", eventLabel: "Phone upload" }] : [] } });
    } else if (pathname.endsWith("/upload-sessions") && request.method() === "POST") {
      uploaded = true;
      await route.fulfill({ status: 201, json: { session: { id: "session1" }, entries: [{ assetId: "phoneasset", storagePath: "projects/phone-upload-fixture/uploads/phoneasset" }] } });
    } else if (pathname.includes("/upload-sessions/") || pathname.endsWith("/edits") || pathname.endsWith("/edits/conversation")) {
      await route.fulfill({ status: 200, json: { revision: 1, ops: [] } });
    } else {
      await route.fulfill({ status: 200, json: {} });
    }
  });
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (/\/v0\/b\/|firebasestorage\.googleapis\.com/.test(url)) {
      await route.fulfill({ status: 200, contentType: "application/json", json: { name: "upload", bucket: "demo-mosae.appspot.com", generation: "123", metageneration: "1", contentType: "image/jpeg", timeCreated: "2026-10-05T00:00:00.000Z", updated: "2026-10-05T00:00:00.000Z", size: "12" } });
      return;
    }
    await route.fallback();
  });

  await page.goto(editorUrl);
  await expect(page.getByRole("button", { name: "Select clip clip-1" })).toBeVisible();
  await page.getByRole("button", { name: "Select clip clip-1" }).click();
  await page.getByRole("button", { name: "Add clip" }).click();
  const upload = page.getByRole("button", { name: "Upload from phone" });
  await expect(upload).toBeVisible();
  const bounds = await upload.boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  await page.locator('input[type="file"][accept="image/*,video/*"]').setInputFiles({ name: "phone.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fake-photo") });
  await expect(page.getByRole("button", { name: "Select clip add:phoneasset_shot1:1" })).toBeVisible({ timeout: 20_000 });
  const orderedClips = await page.getByLabel("Unified timeline").locator('button[aria-label^="Select clip "]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  expect(orderedClips.indexOf("Select clip add:phoneasset_shot1:1")).toBe(orderedClips.indexOf("Select clip clip-1") + 1);

  await page.getByRole("button", { name: "Select clip collage-1" }).click();
  await page.getByLabel("Select collage cell slot-1").click({ force: true });
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByRole("button", { name: "Upload from phone" })).toBeVisible();
});
