import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
// Release 1 acceptance. API/Firestore/Storage remain real emulators unless a
// test explicitly labels a response as synthetic. Run with MOCK_GEMINI=replay.
const r1Samples = path.resolve("services/api/fixtures/demo/trip1-v2/photos");
const r1Evidence = path.resolve(process.env.R1_EVIDENCE_DIR ?? ".superpowers/acceptance-r1/evidence");
async function evidence(page: Page, name: string) {
  await mkdir(r1Evidence, { recursive: true });
  await page.screenshot({ path: path.join(r1Evidence, `${name}.png`) });
}
async function pick(page: Page, count = 1) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create a new film" }).first().click();
  await page.locator('input[type="file"]').setInputFiles(
    ["d1-01.jpg", "d1-02.jpg"].slice(0, count).map(name => path.join(r1Samples, name)),
  );
  await page.waitForURL("**/director?**", { timeout: 60_000 });
}
async function noConfirmation(page: Page) {
  await expect(page.getByRole("button", { name: /^Yes,/ })).toHaveCount(0);
  await expect(page.getByText(/I've looked through all/)).toHaveCount(0);
}

test("R1 real upload: transfer delay retains story context and cannot plan", async ({ page }) => {
  test.setTimeout(120_000);
  const plans: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && /\/story-intents$/.test(request.url())) plans.push(request.url()); });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/:28199\/.*upload/, async route => { await gate; await route.continue(); });
  try {
    await pick(page, 2);
    await expect(page.getByLabel("Tell me anything about the story")).toBeVisible();
    await noConfirmation(page);
    await page.getByLabel("Tell me anything about the story").fill("Mia's birthday portraits");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Mia's birthday portraits", { exact: true })).toBeVisible();
    await noConfirmation(page);
    expect(plans).toEqual([]);
    await evidence(page, "upload-delay-context");
  } finally { release(); }
});

for (const fixture of [
  { name: "empty", total: 0, understood: 0, story: false, expected: 0, settled: 0, closed: true },
  { name: "partial transfer", total: 1, understood: 1, story: false, expected: 12, settled: 1, closed: false },
  { name: "partial understanding", total: 2, understood: 1, story: false, expected: 2, settled: 2, closed: true },
]) {
  test(`R1 synthetic summary: ${fixture.name} cannot claim review or confirm`, async ({ page }) => {
    await page.route(/\/api\/projects\/[^/]+\/summary$/, route => route.fulfill({ json: {
      total: fixture.total, photos: fixture.total, clips: 0, days: 0, places: [], country: null, season: null, dateRange: null,
      processed: { ingested: fixture.total, understood: fixture.understood, faces: 0 },
      ready: { summary: fixture.understood > 0, faces: false, plan: false, story: fixture.story },
      upload: { expected: fixture.expected, settled: fixture.settled, failed: 0, cancelled: 0, closed: fixture.closed },
    } }));
    const summaryResponse = page.waitForResponse(response => /\/api\/projects\/synthetic-readiness\/summary$/.test(response.url()));
    await page.goto("/director?repository=api&projectId=synthetic-readiness");
    await summaryResponse;
    await expect(page.getByLabel("Tell me anything about the story")).toBeVisible();
    await noConfirmation(page);
    await evidence(page, fixture.name.replaceAll(" ", "-"));
  });
}

test("R1 synthetic summary with no story suggestion asks openly without confirm chips", async ({ page }) => {
  await page.route(/\/api\/projects\/[^/]+\/summary$/, route => route.fulfill({ json: {
    total: 14, photos: 14, clips: 0, days: 1, places: [], country: null, season: null, dateRange: null,
    processed: { ingested: 14, understood: 14, faces: 0 },
    ready: { summary: true, faces: true, plan: false, story: true },
  } }));
  const summaryResponse = page.waitForResponse(response => /\/api\/projects\/open-story-question\/summary$/.test(response.url()));
  await page.goto("/director?repository=api&projectId=open-story-question");
  await summaryResponse;
  await expect(page.getByText("What were these 14 moments about?", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Yes,/ })).toHaveCount(0);
});

test("R1 real upload: all-failed transfer offers retry and cannot continue", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(/:28199\//, route => route.fulfill({ status: 403, json: { error: { code: 403, message: "Synthetic denied upload" } } }));
  await pick(page);
  await expect(page.getByRole("button", { name: "Retry uploads" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Continue with uploaded files" })).toHaveCount(0);
  await noConfirmation(page);
  await evidence(page, "all-failed-retry");
});

test("R1 replay: fresh demo reaches direction once and resumes after reload", async ({ page }) => {
  test.setTimeout(180_000);
  const requests: { method: string; path: string; body: string | null; status?: number }[] = [];
  page.on("response", response => {
    if (/\/api\//.test(response.url())) requests.push({ method: response.request().method(), path: new URL(response.url()).pathname, body: response.request().postData(), status: response.status() });
  });
  await page.goto("/");
  await page.getByText("Try with a demo trip", { exact: true }).click();
  await page.waitForURL("**/director?**", { timeout: 120_000 });
  const yes = page.getByRole("button", { name: /^Yes,/ });
  await expect(yes).toBeVisible({ timeout: 60_000 });
  await evidence(page, "fresh-demo-ready");
  await yes.click();
  const everyone = page.getByRole("button", { name: "That's everyone" });
  for (let i = 0; i < 8; i++) {
    if (await everyone.isVisible()) { await everyone.click(); break; }
    const friend = page.getByRole("button", { name: "Friend", exact: true });
    if (await friend.isVisible()) { await friend.click(); await page.waitForTimeout(300); }
    else { await page.waitForTimeout(1000); }
  }
  const looksFine = page.getByRole("button", { name: "Looks good", exact: true });
  await expect.poll(async () => await looksFine.isVisible() || await page.getByRole("button", { name: "Sounds good", exact: true }).isVisible(), { timeout: 120_000 }).toBe(true);
  if (await looksFine.isVisible()) await looksFine.click();
  const confirm = page.getByRole("button", { name: "Sounds good", exact: true });
  await expect(confirm).toHaveCount(1);
  await expect(confirm).toBeVisible();
  await expect(page.getByRole("button", { name: "Everyone", exact: true })).toBeVisible();
  await expect(page.getByText(/These moments can make about|Add more photos for a longer film|For a \d+-day trip/)).toHaveCount(0);
  expect(requests.filter(r => r.method === "POST" && /\/story-intents$/.test(r.path))).toHaveLength(1);
  await expect(page.getByText("For these moments, I’d suggest this.", { exact: true })).toBeVisible();
  await evidence(page, "demo-direction");
  await confirm.click();
  await writeFile(path.join(r1Evidence, "demo-requests.json"), JSON.stringify(requests, null, 2));
  await expect(page.getByRole("button", { name: "Save film", exact: true })).toBeVisible({ timeout: 120_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Save film", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeVisible();
  const video = page.locator("video");
  await play.click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 15_000 }).toBeGreaterThan(0.2);
  expect(requests.filter(r => r.method === "POST" && /\/generations$/.test(r.path))).toHaveLength(1);
  await evidence(page, "resumed-film");
  await writeFile(path.join(r1Evidence, "demo-requests.json"), JSON.stringify(requests, null, 2));
});

test("R1 synthetic readiness with real partial transfer: acknowledge successful files before confirmation", async ({ page }) => {
  test.setTimeout(120_000);
  let denied = false;
  await page.route(/:28199\//, async route => {
    if (!denied && route.request().method() === "POST") {
      denied = true;
      await route.fulfill({ status: 403, json: { error: { code: 403, message: "Synthetic denied upload" } } });
    } else await route.continue();
  });
  await page.route(/\/api\/projects\/[^/]+\/summary$/, route => route.fulfill({ json: {
    total: 1, photos: 1, clips: 0, days: 0, places: [], country: null, season: null, dateRange: null,
    processed: { ingested: 1, understood: 1, faces: 0 },
    ready: { summary: true, faces: true, plan: false, story: true },
    upload: { expected: 2, settled: 2, failed: 1, cancelled: 0, closed: true },
  } }));
  await pick(page, 2);
  const proceed = page.getByRole("button", { name: "Continue with uploaded files" });
  await expect(proceed).toBeVisible({ timeout: 60_000 });
  await noConfirmation(page);
  await expect(page.getByRole("button", { name: "Retry uploads" })).toBeVisible();
  await evidence(page, "partial-failure-before-acknowledgement");
  await proceed.click();
  await expect(page.getByRole("button", { name: /^Yes,/ })).toBeVisible();
  await expect(page.getByText(/I've looked through all 1/)).toBeVisible();
  await evidence(page, "partial-failure-acknowledged");
});

test("R1 synthetic portrait fixture: sole named focus, contextual recommendation, recoverable composition", async ({ page }) => {
  test.setTimeout(120_000);
  // Clone a real replay demo's understood catalog and recorded plan, replacing
  // only the test's story/cast. This is synthetic UX evidence, not a model run.
  const { initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:28085";
  const app = initializeApp({ projectId: "demo-contextual-r1" }, `r1-${Date.now()}`);
  const db = getFirestore(app);
  const tokenRequest = page.waitForRequest(request => /\/api\/projects$/.test(request.url()) && Boolean(request.headers().authorization));
  await page.goto("/");
  const authorization = (await tokenRequest).headers().authorization;
  const uid = JSON.parse(Buffer.from(authorization.split(".")[1]!, "base64url").toString()).user_id;
  await page.getByText("Try with a demo trip", { exact: true }).click();
  await page.waitForURL("**/director?**", { timeout: 120_000 });
  const sourceId = new URL(page.url()).searchParams.get("projectId")!;
  await page.getByRole("button", { name: /^Yes,/ }).click();
  const sourceRef = db.collection("projects").doc(sourceId);
  await expect.poll(async () => (await sourceRef.get()).get("currentProposalId"), { timeout: 60_000 }).toBeTruthy();
  const source = await sourceRef.get();
  const ref = db.collection("projects").doc();
  const proposalId = "portrait-proposal";
  const original = (await source!.ref.collection("storyProposals").doc(source!.get("currentProposalId")).get()).data()!;
  await ref.set({ ...source!.data(), id: ref.id, userId: uid, currentProposalId: proposalId, generationIds: [], title: "Mia's portraits", dateRange: null, demo: false });
  const shots: { shotId: string; assetId: string; faces: unknown[] }[] = [];
  for (const collection of ["assets", "shots", "events"]) {
    for (const doc of (await source!.ref.collection(collection).get()).docs) {
      await ref.collection(collection).doc(doc.id).set({ ...doc.data(), projectId: ref.id, userId: uid, ...(collection === "assets" ? { place: null, media: { ...doc.get("media"), localTime: null, gps: null } } : {}) });
      if (collection === "shots") shots.push({ shotId: doc.id, assetId: doc.get("assetId"), faces: [{ faceId: `face-${doc.id}`, characterId: "mia", bbox: [0.1, 0.1, 0.5, 0.5] }] });
    }
  }
  await ref.collection("cast").doc("current").set({ confirmed: true, people: [{ personId: "mia", name: "Mia", role: "child" }] });
  await ref.collection("storyIntents").doc("portrait-intent").set({ text: "Mia's birthday portraits" });
  await ref.collection("storyProposals").doc(proposalId).set({ ...original, id: proposalId, projectId: ref.id, storyIntentId: "portrait-intent", state: "draft", directionRecommendation: "For Mia's portraits, I'd suggest a gentle pace." });
  await page.route(new RegExp(`/api/projects/${ref.id}/characters$`), route => route.fulfill({ json: { shots } }));
  const submitted: any[] = [];
  await page.route(new RegExp(`/api/projects/${ref.id}/generations$`), async route => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { error: "Synthetic recoverable composition failure" } });
  });
  await page.goto(`/director?repository=api&projectId=${ref.id}`);
  const everyone = page.getByRole("button", { name: "That's everyone" });
  if (await everyone.isVisible()) await everyone.click();
  const fine = page.getByRole("button", { name: "Looks good", exact: true });
  await expect.poll(async () => await fine.isVisible() || await page.getByRole("button", { name: "Sounds good", exact: true }).isVisible() || await everyone.isVisible()).toBe(true);
  if (await everyone.isVisible()) await everyone.click();
  if (await fine.isVisible()) await fine.click();
  await expect(page.getByText("For Mia's portraits, I'd suggest a gentle pace.", { exact: true })).toBeVisible();
  const mia = page.getByRole("button", { name: "Mia", exact: true });
  await expect(mia).toHaveAttribute("aria-pressed", "true");
  const confirm = page.getByRole("button", { name: "Sounds good", exact: true });
  await expect(confirm).toHaveCount(1);
  await expect(page.getByText(/For a \d+-day trip|It looks like a trip|These moments can make about|Add more photos for a longer film/)).toHaveCount(0);
  await evidence(page, "portrait-single-focus");
  await confirm.click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0].settings.focus).toBe("mia");
  await evidence(page, "portrait-recoverable-error");
  await writeFile(path.join(r1Evidence, "portrait-generation-request.json"), JSON.stringify(submitted, null, 2));
  await expect(confirm).toBeEnabled();
  await expect(mia).toHaveAttribute("aria-pressed", "true");
  await confirm.click();
  await expect.poll(() => submitted.length).toBe(2);
  expect(submitted[1].settings).toMatchObject({ focus: "mia", cadenceId: submitted[0].settings.cadenceId, durationId: submitted[0].settings.durationId, collageAmount: submitted[0].settings.collageAmount, motionFeel: submitted[0].settings.motionFeel });
  await expect(confirm).toBeEnabled();
  await evidence(page, "portrait-recoverable-error");
  await writeFile(path.join(r1Evidence, "portrait-generation-request.json"), JSON.stringify(submitted, null, 2));
});
