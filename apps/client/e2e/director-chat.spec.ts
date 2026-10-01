import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const samples = path.resolve(process.env.SAMPLES_DIR ?? "/Users/isaacteh/Projects/Triiz/mosae/poc/gemini/samples", "trip1-v2");
const tripFiles = [
  "d1-01.jpg", "d1-02.jpg", "d1-03.jpg", "d1-04.jpg", "d1-05.jpg", "d1-06.jpg", "d1-07.jpg", "d1-08.jpg", "d1-09.jpg", "d1-10.jpg", "d1-11.jpg", "d1-12.jpg",
  "x-photobomb.jpg", "x-distant.jpg", "x-stranger.jpg",
];
const screenshots = path.resolve(process.env.DIRECTOR_CHAT_SCREENSHOTS_DIR ?? "docs/design/screens-chat-v2");
const styleScreenshots = screenshots;
const timingsPath = path.resolve(process.env.DIRECTOR_CHAT_TIMINGS_PATH ?? "docs/research/2026-09-28-director-chat-v2-timings.md");
const misses = path.resolve(process.cwd(), "services/api/fixtures/gemini-misses");

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(screenshots, name), fullPage: false });
}

test("verifies phase 1 on trip1-v2 from Home through Saved and restores the thread after reload", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await page.setViewportSize({ width: 412, height: 870 });
  await mkdir(screenshots, { recursive: true });
  await mkdir(styleScreenshots, { recursive: true });
  const existing = await readdir(samples);
  const media = tripFiles.map((name) => path.join(samples, name));
  expect(media.every((file) => existing.includes(path.basename(file))), "trip1-v2 sample files from make-trip1-v2.ts must be available").toBe(true);
  let uploadStartedAt = Date.now();
  const previousMisses = new Set(await readdir(misses).catch(() => []));
  const readyAt: Partial<Record<"summary" | "faces" | "plan" | "film", number>> = {};
  const missingKeys: string[] = [];
  const apiFailures: string[] = [];
  let resolvePlanJob!: (job: { projectId: string; jobId: string; auth: string }) => void;
  const planJobCreated = new Promise<{ projectId: string; jobId: string; auth: string }>((resolve) => { resolvePlanJob = resolve; });
  page.on("response", async (response) => {
    if (response.status() >= 400 && /\/api\//.test(response.url())) {
      const route = new URL(response.url()).pathname.replace(/\/projects\/[^/]+/, "/projects/:id");
      const failure = await response.json().catch(() => ({})) as { error?: string };
      const projectId = /\/projects\/([^/]+)/.exec(new URL(response.url()).pathname)?.[1];
      let proposalId: string | undefined;
      try { proposalId = JSON.parse(response.request().postData() ?? "{}").proposalId; } catch { /* non-JSON request */ }
      apiFailures.push(`${response.request().method()} ${route} -> ${response.status()}${failure.error ? ` (${failure.error})` : ""}${projectId && route.endsWith("/cast") ? ` [project ${projectId}${proposalId ? `, proposal ${proposalId}` : ""}]` : ""}`);
    }
    if (/\/api\/projects\/[^/]+\/summary$/.test(response.url()) && response.ok()) {
      const value = await response.json().catch(() => null) as { total?: number; ready?: Record<string, boolean> } | null;
      if (value?.total === tripFiles.length) {
        for (const key of ["summary", "faces", "plan"] as const) if (value.ready?.[key] && readyAt[key] === undefined) readyAt[key] = Date.now();
      }
    }
    if (response.status() >= 500 && /\/api\//.test(response.url())) {
      const text = await response.text().catch(() => "");
      const match = /no recorded gemini response for key ([a-f0-9]{64})/.exec(text);
      if (match) missingKeys.push(match[1]);
    }
    if (response.request().method() === "POST" && /\/api\/projects\/[^/]+\/story-intents$/.test(response.url()) && response.ok()) {
      const match = /\/api\/projects\/([^/]+)\/story-intents$/.exec(response.url());
      const value = await response.json().catch(() => null) as { job?: { id?: string } } | null;
      const auth = response.request().headers().authorization;
      if (match?.[1] && value?.job?.id && auth) {
        resolvePlanJob({ projectId: match[1], jobId: value.job.id, auth });
      }
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Many moments. One story." })).toBeVisible();
  const mosaicTiles = page.getByLabel("Mosaé tile mosaic").locator("div");
  await expect(mosaicTiles).toHaveCount(12);
  const tileRowsAndColumns = await mosaicTiles.evaluateAll((tiles) => {
    const rows = new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().top)));
    const columns = new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().left)));
    return { rows: rows.size, columns: columns.size };
  });
  expect(tileRowsAndColumns).toEqual({ rows: 3, columns: 4 });
  await expect(page.getByRole("button", { name: "Create a new film" })).toHaveCount(1);
  await expect(page.getByLabel("Four tiles")).toBeVisible();
  await expect(page.getByLabel("Four tiles").locator("div")).toHaveCount(4);
  await screenshot(page, "01-home-empty.png");

  await page.getByRole("button", { name: "Create a new film" }).first().click();
  await page.locator('input[type="file"]').setInputFiles(media);
  uploadStartedAt = Date.now();
  await page.waitForURL("**/director?**", { timeout: 60_000 });
  await expect(page.getByText("Camera Roll", { exact: true })).toHaveCount(0);
  await screenshot(page, "pt-01-direct-upload-to-chat.png");
  await expect(page.getByText(`I've looked through all ${tripFiles.length}`)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("Singapore, June", { exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/I've looked through all 15\. It looks like a trip to Singapore/)).toBeVisible();
  expect((await page.locator("body").innerText()).match(/Is that the story\?/g)).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Yes, our Singapore trip" })).toBeVisible();
  await screenshot(page, "04-occasion-singapore.png");

  const composer = page.getByLabel("Tell me anything about the story");
  await composer.fill("it's our Singapore holiday with the kids");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("it's our Singapore holiday with the kids")).toBeVisible({ timeout: 60_000 });
  const interpretationReply = page.getByText(/Should I create a story about your Singapore family holiday\?|Would you like me to focus the story on your Singapore holiday with the kids\?|Would you like to center the story on your Singapore holiday with the kids\?/);
  await expect(interpretationReply).toBeVisible({ timeout: 60_000 });
  const interpretationText = (await interpretationReply.innerText()).trim();
  const typedBubble = page.getByText("it's our Singapore holiday with the kids", { exact: true });
  expect(await typedBubble.evaluate((node, text) => {
    const reply = [...document.querySelectorAll("*")].find((item) => item.childElementCount === 0 && item.textContent?.trim() === text);
    return Boolean(reply && node.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, interpretationText)).toBe(true);
  await expect(page.getByText("Did I get that right?")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Not quite" })).toBeVisible();
  await expect(page.getByText("I didn't catch that. Pick one below, or say it another way.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Yes, our Singapore trip" })).toHaveCount(0);
  await expect(page.getByText("0 of 4 confirmed", { exact: true })).toBeVisible();
  await screenshot(page, "pt-04-answer-chips.png");
  // The typed suggestion is still pending until confirmed. Reload restores the
  // initial occasion state so the primary Yes chip can drive the full film run.
  await page.reload();
  await expect(page.getByRole("button", { name: "Yes, our Singapore trip" })).toBeVisible({ timeout: 60_000 });

  const yes = page.getByRole("button", { name: /^Yes,/ });
  await expect(yes).toBeVisible({ timeout: 180_000 });
  await yes.click();
  await expect(page.getByText("One person appears in")).toBeVisible({ timeout: 120_000 });
  const faceImages = page.locator('img[alt^="Person photo "]');
  await expect(faceImages).toHaveCount(4);
  await expect.poll(() => faceImages.evaluateAll((images) => images.filter((image) => (image as HTMLImageElement).naturalWidth > 0).length), { timeout: 60_000 }).toBe(4);
  await expect.poll(() => faceImages.first().evaluate((image) =>
    Number.parseFloat(getComputedStyle(image.parentElement!).width) > 72,
  ), { timeout: 10_000 }).toBe(true);
  await screenshot(page, "06-person-question.png");
  await expect(page.getByText(/\d+ of \d+ shown · Day /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await page.getByRole("button", { name: "Type a name" }).click();
  await page.getByLabel("Person name").fill("Mia");
  const nameCastResponse = page.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/projects\/[^/]+\/cast$/.test(response.url()));
  await page.getByText("Save name").click();
  const savedNameResponse = await nameCastResponse;
  if (!savedNameResponse.ok()) console.log("Name cast update failed:", savedNameResponse.status(), savedNameResponse.url(), savedNameResponse.request().postData(), await savedNameResponse.text());
  expect(savedNameResponse.ok()).toBe(true);
  await expect(page.getByText("Mia", { exact: true })).toBeVisible();
  const previousFriendReplies = await page.getByText("Friend", { exact: true }).count();
  const friendCastResponse = page.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/projects\/[^/]+\/cast$/.test(response.url()));
  await page.getByRole("button", { name: "Friend" }).click();
  expect((await friendCastResponse).ok()).toBe(true);
  await expect.poll(() => page.getByText("Friend", { exact: true }).count(), { timeout: 30_000 }).toBeGreaterThan(previousFriendReplies);
  const friendChip = page.getByRole("button", { name: "Friend" });
  const everyone = page.getByRole("button", { name: "No, that's everyone" });
  for (let answer = 0; answer < 3; answer += 1) {
    if (await everyone.count()) break;
    const previousReplies = await page.getByText("Friend", { exact: true }).count();
    const friendCastResponse = page.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/projects\/[^/]+\/cast$/.test(response.url()));
    await friendChip.click();
    const friendResponse = await friendCastResponse;
    if (!friendResponse.ok()) console.log("Person cast update failed:", friendResponse.status(), friendResponse.url(), friendResponse.request().postData(), await friendResponse.text());
    expect(friendResponse.ok()).toBe(true);
    await expect.poll(async () => (await everyone.count()) > 0 || (await page.getByText("Friend", { exact: true }).count()) > previousReplies, { timeout: 30_000 }).toBe(true);
  }
  await expect(everyone).toBeVisible({ timeout: 30_000 });
  await everyone.click();

  {
    const createdPlanJob = await planJobCreated;
    const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
    const jobUrl = `http://${firestoreEmulatorHost}/v1/projects/demo-face-e2e/databases/(default)/documents/projects/${createdPlanJob.projectId}/jobs/${createdPlanJob.jobId}`;
    const deadline = Date.now() + 180_000;
    let failedJob: Record<string, unknown> | null = null;
    while (Date.now() < deadline) {
      const response = await page.request.get(jobUrl, { headers: { Authorization: createdPlanJob.auth } });
      if (response.ok()) {
        const document = await response.json() as { fields?: Record<string, { stringValue?: string; arrayValue?: { values?: { stringValue?: string }[] } }> };
        const status = document.fields?.status?.stringValue;
        if (status === "failed") { failedJob = document.fields as Record<string, unknown>; break; }
        if (status === "succeeded") break;
      }
      await page.waitForTimeout(1_000);
    }
    if (failedJob) {
      await screenshot(page, "07-plan-failed.png");
      const newMisses = (await readdir(misses).catch(() => [])).filter((name) => name.startsWith("direct-") && !previousMisses.has(name));
      const keys = await Promise.all(newMisses.map(async (name) => createHash("sha256").update(await readFile(path.join(misses, name))).digest("hex")));
      const diagnostics = (failedJob.diagnostics as { arrayValue?: { values?: { stringValue?: string }[] } } | undefined)?.arrayValue?.values?.map((item) => item.stringValue ?? "") ?? [];
      const rows = [
        "# Director chat timing — trip1-v2",
        "",
        "E2E stopped at plan generation in MOCK_GEMINI=record; see the stored job diagnostics below.",
        "",
        `Local trip1-v2 fixture set: ${tripFiles.length} photos, including the synthetic photobomb and distant stranger.`,
        `- Upload to summary ready: ${readyAt.summary === undefined ? "not observed" : ((readyAt.summary - uploadStartedAt) / 1000).toFixed(1) + " s"}`,
        `- Upload to face groups ready: ${readyAt.faces === undefined ? "not observed" : ((readyAt.faces - uploadStartedAt) / 1000).toFixed(1) + " s"}`,
        "- Upload to first plan ready: not reached; the plan job failed during replay.",
        `- Direct request-key digests: ${keys.length ? keys.join(", ") : "none captured"}`,
        ...diagnostics.map((item) => `- Plan validation: ${item}`),
        "",
        "The run used the 15-photo trip1-v2 test set; these timings are for the smaller browser verification set.",
        "",
      ];
      await mkdir(path.dirname(timingsPath), { recursive: true });
      await writeFile(timingsPath, rows.join("\n"));
      throw new Error(`BACKLOG 18 replay mismatch; missing exact request keys: ${keys.join(", ") || "none (same-stage fallback was used)"}`);
    }
  }

  const filteredPhotoCard = page.getByLabel("Filtered photos");
  await expect(filteredPhotoCard).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/I've set aside \d+ blurry shots? and \d+ near-duplicates?, keeping the best of each burst\. Your originals are untouched\./)).toBeVisible();
  await expect(filteredPhotoCard.getByRole("button", { name: /^Blurry \d+$/ })).toBeVisible();
  await expect(filteredPhotoCard.getByRole("button", { name: /^Near-duplicates \d+$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Looks fine" })).toBeVisible();
  await expect(page.getByText("Any moments that must be in the film")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Choose from all / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Done" })).toHaveCount(0);
  await screenshot(page, "pt-05-filtered-photos.png");
  const chatHistory = page.getByLabel("Director chat history");
  await expect.poll(() => chatHistory.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await chatHistory.evaluate((node) => { node.scrollTop = 0; });
  await expect.poll(() => chatHistory.evaluate((node) => node.scrollTop)).toBe(0);

  await page.getByRole("button", { name: "Looks fine" }).click();
  try {
    await expect(page.getByRole("button", { name: "Sounds good. Shape it." })).toBeVisible({ timeout: 120_000 });
  } catch (error) {
    if (apiFailures.length) console.log("API requests returned errors:", apiFailures.join("; "));
    throw error;
  }
  await screenshot(page, "08-direction.png");
  await expect(page.getByRole("button", { name: "A few" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Calm" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Sounds good. Shape it." }).click();
  await screenshot(page, "09-shaping.png");
  const save = page.getByRole("button", { name: "Save film" });
  try {
    await expect(save).toBeVisible({ timeout: 300_000 });
  } catch (error) {
    if (missingKeys.length) throw new Error("Replay fixture missing request key: " + missingKeys.at(-1));
    throw error;
  }
  readyAt.film = Date.now();
  await screenshot(page, "10-film-ready.png");
  await page.screenshot({ path: path.join(styleScreenshots, "film-ready.png"), fullPage: false });

  await page.getByRole("button", { name: "Save film" }).click();
  await expect(page.getByText("Saved to your films")).toBeVisible({ timeout: 300_000 });
  await screenshot(page, "11-saved.png");
  const savedScreen = await page.locator("body").innerText();
  await page.reload();
  await expect(page.getByText("Saved to your films")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("button", { name: "Back to your films" })).toBeVisible();
  expect(await page.locator("body").innerText()).toContain(savedScreen.slice(-50));
  await screenshot(page, "12-saved-reload.png");
  const editorTimelineResponse = page.waitForResponse((response) => response.request().method() === "GET" && /\/api\/projects\/[^/]+\/generations\/[^/]+$/.test(new URL(response.url()).pathname));
  await page.getByRole("button", { name: "Still editable anytime" }).click();
  await page.waitForURL("**/editor?**");
  await expect(page.getByText("Edit film")).toBeVisible();
  const editorTimeline = await (await editorTimelineResponse).json() as {
    timeline: { videoClips: { clipId?: string; source?: { shotId: string }; kind?: string; spec?: { slots: { shotId: string }[] } }[]; audioClips: { role: string; source: { kind: string; soundtrackId?: string } }[] };
    sources: Record<string, string>;
  };
  expect(editorTimeline.timeline.videoClips.length).toBeGreaterThanOrEqual(1);
  const collageClip = editorTimeline.timeline.videoClips.find((clip) => clip.kind === "collage");
  expect(collageClip, "default A few direction should produce a collage on trip1-v2").toBeTruthy();
  const soundtrack = editorTimeline.timeline.audioClips.find((clip) => clip.role === "music" && clip.source.kind === "soundtrack");
  expect(soundtrack?.source.soundtrackId).toBeTruthy();
  const sourceShotIds = [...new Set(editorTimeline.timeline.videoClips.flatMap((clip) => clip.source ? [clip.source.shotId] : clip.spec?.slots.map((slot) => slot.shotId) ?? []))];
  expect(sourceShotIds.length).toBeGreaterThanOrEqual(3);
  const imageUrls = sourceShotIds.map((id) => editorTimeline.sources[id]);
  expect(imageUrls.every((url) => url?.startsWith("http://127.0.0.1:9199/download/storage/v1/b/demo-mosae.appspot.com/o/"))).toBe(true);
  const firstImage = await page.request.get(imageUrls[0]!);
  expect(firstImage.status()).toBe(200);
  expect(firstImage.headers()["content-type"]).toMatch(/^image\//);
  const audioUrl = editorTimeline.sources[soundtrack!.source.soundtrackId!];
  expect(audioUrl).toContain("/download/storage/v1/b/demo-mosae.appspot.com/o/");
  const audioResponse = await page.request.get(audioUrl);
  expect(audioResponse.status()).toBe(200);
  expect(audioResponse.headers()["content-type"]).toMatch(/^audio\//);
  const stripClips = page.getByRole("button", { name: /^Select clip / });
  await expect(stripClips.first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => stripClips.count()).toBeGreaterThanOrEqual(1);
  await expect.poll(() => stripClips.locator("img").evaluateAll((images) => images.filter((image) => (image as HTMLImageElement).naturalWidth > 0).length), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("button", { name: `Select clip ${collageClip!.clipId}` })).toBeVisible();
  await expect.poll(() => page.getByRole("button", { name: `Select clip ${collageClip!.clipId}` }).locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByText("No soundtrack", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(styleScreenshots, "editor-collage-strip.png"), fullPage: false });
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("button", { name: "Back to your films" })).toBeVisible();
  await page.getByRole("button", { name: "Back to your films" }).click();
  await expect(page.getByRole("heading", { name: "Your films" })).toBeVisible();
  await screenshot(page, "13-home-filled.png");
  await expect(page.getByText("Just saved").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a new film" })).toHaveCount(1);
  await screenshot(page, "14-home-film-saved.png");

  const rows = ["# Director chat timing — trip1-v2", "", "Measured from starting upload. Readiness milestones come from the project summary endpoint; film ready is the first visible Save film action.", "", `Local trip1-v2 fixture set: ${tripFiles.length} photos, including the synthetic photobomb and distant stranger.`, ""];
  for (const key of ["summary", "faces", "plan", "film"] as const) rows.push(`- Upload to ${key === "film" ? "film ready" : `${key} ready`}: ${readyAt[key] === undefined ? "not observed" : ((readyAt[key]! - uploadStartedAt) / 1000).toFixed(1) + " s"}`);
  rows.push("", "The run used the 15-photo trip1-v2 test set, including the synthetic photobomb and distant stranger.", "");
  await mkdir(path.dirname(timingsPath), { recursive: true });
  await writeFile(timingsPath, rows.join("\n"));
});
