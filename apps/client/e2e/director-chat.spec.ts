import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const samples = path.resolve(process.env.SAMPLES_DIR ?? "/Users/isaacteh/Projects/Triiz/mosae/poc/gemini/samples", "trip1");
const trip1Files = [
  "pexels-vo-van-ti-n-2037497312-34133873.jpg", "pexels-vo-van-ti-n-2037497312-34133876.jpg",
  "pexels-vo-van-ti-n-2037497312-34133877.jpg", "pexels-vo-van-ti-n-2037497312-34133878.jpg",
  "pexels-vo-van-ti-n-2037497312-34133880.jpg", "pexels-vo-van-ti-n-2037497312-34133884.jpg",
  "pexels-vo-van-ti-n-2037497312-34133885.jpg", "pexels-vo-van-ti-n-2037497312-34133887.jpg",
  "pexels-vo-van-ti-n-2037497312-34133888.jpg", "pexels-vo-van-ti-n-2037497312-34133920.jpg",
  "pexels-vo-van-ti-n-2037497312-34133922.jpg", "pexels-vo-van-ti-n-2037497312-34133923.jpg",
];
const screenshots = path.resolve(process.cwd(), "docs/design/screens-chat");
const timingsPath = path.resolve(process.cwd(), "docs/research/2026-09-28-director-chat-timings.md");
const misses = path.resolve(process.cwd(), "services/api/fixtures/gemini-misses");
const replayInputPath = process.env.CHAT_REPLAY_INPUT ?? "/tmp/mosae-chat-interpret-replay-input.json";

async function screenshot(page: Page, number: number) {
  await page.screenshot({ path: path.join(screenshots, String(number).padStart(2, "0") + "-step.png"), fullPage: true });
}

test("directs a trip1 film from Home through Saved and restores the saved film after reload", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await mkdir(screenshots, { recursive: true });
  const existing = await readdir(samples);
  const media = trip1Files.map((name) => path.join(samples, name));
  expect(media.every((file) => existing.includes(path.basename(file))), "trip1 sample files must be available as in services/api/scripts").toBe(true);
  let uploadStartedAt = Date.now();
  const previousMisses = new Set(await readdir(misses).catch(() => []));
  const readyAt: Partial<Record<"summary" | "faces" | "plan" | "film", number>> = {};
  const missingKeys: string[] = [];
  const apiFailures: string[] = [];
  let projectIdForChat: string | undefined;
  let authForChat: string | undefined;
  let summaryForChat: Record<string, unknown> | undefined;
  let resolvePlanJob!: (job: { projectId: string; jobId: string; auth: string }) => void;
  const planJobCreated = new Promise<{ projectId: string; jobId: string; auth: string }>((resolve) => { resolvePlanJob = resolve; });
  page.on("response", async (response) => {
    if (response.status() >= 400 && /\/api\//.test(response.url())) {
      const route = new URL(response.url()).pathname.replace(/\/projects\/[^/]+/, "/projects/:id");
      const failure = await response.json().catch(() => ({})) as { error?: string };
      apiFailures.push(`${response.request().method()} ${route} -> ${response.status()}${failure.error ? ` (${failure.error})` : ""}`);
    }
    if (/\/api\/projects\/[^/]+\/summary$/.test(response.url()) && response.ok()) {
      const value = await response.json().catch(() => null) as { total?: number; ready?: Record<string, boolean> } | null;
      if (value?.total === trip1Files.length) {
        summaryForChat = value as Record<string, unknown>;
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
        projectIdForChat = match[1];
        authForChat = auth;
        resolvePlanJob({ projectId: match[1], jobId: value.job.id, auth });
      }
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Many moments. One story." })).toBeVisible();
  await screenshot(page, 1);

  await page.getByRole("button", { name: "Create a new film" }).first().click();
  await screenshot(page, 2);
  await page.locator('input[type="file"]').setInputFiles(media);
  await page.waitForURL("**/pick-memory");
  await screenshot(page, 3);

  uploadStartedAt = Date.now();
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForURL("**/director?**", { timeout: 60_000 });
  await expect(page.getByText("I've looked through all 12")).toBeVisible({ timeout: 180_000 });
  await screenshot(page, 4);

  const yes = page.getByRole("button", { name: /^Yes,/ });
  await expect(yes).toBeVisible({ timeout: 180_000 });
  await yes.click();
  await screenshot(page, 5);
  await expect(page.getByText("One person appears in")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Type a name" }).click();
  await page.getByLabel("Person name").fill("Mia");
  await page.getByText("Save name").click();
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0, { timeout: 30_000 });

  {
    const createdPlanJob = await planJobCreated;
    const jobUrl = `http://127.0.0.1:8085/v1/projects/demo-mosae/databases/(default)/documents/projects/${createdPlanJob.projectId}/jobs/${createdPlanJob.jobId}`;
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
      await screenshot(page, 6);
      const newMisses = (await readdir(misses).catch(() => [])).filter((name) => name.startsWith("direct-") && !previousMisses.has(name));
      const keys = await Promise.all(newMisses.map(async (name) => createHash("sha256").update(await readFile(path.join(misses, name))).digest("hex")));
      const diagnostics = (failedJob.diagnostics as { arrayValue?: { values?: { stringValue?: string }[] } } | undefined)?.arrayValue?.values?.map((item) => item.stringValue ?? "") ?? [];
      const rows = [
        "# Director chat timing — trip1",
        "",
        "E2E stopped at plan generation: MOCK_GEMINI=replay returned a director response whose shot ids were outside the new project's working set (BACKLOG 18). No record mode was used.",
        "",
        `Local trip1 fixture set: ${trip1Files.length} photos (the checked-in script source set; this is smaller than the spec's approximately 465-item trip1).`,
        `- Upload to summary ready: ${readyAt.summary === undefined ? "not observed" : ((readyAt.summary - uploadStartedAt) / 1000).toFixed(1) + " s"}`,
        `- Upload to face groups ready: ${readyAt.faces === undefined ? "not observed" : ((readyAt.faces - uploadStartedAt) / 1000).toFixed(1) + " s"}`,
        "- Upload to first plan ready: not reached; the plan job failed during replay.",
        `- Missing exact replay request keys: ${keys.length ? keys.join(", ") : "none recorded; replay used same-stage fallback fixtures"}`,
        ...diagnostics.map((item) => `- Plan validation: ${item}`),
        "",
        "D3 recommendation: keep the current occasion → people → moments order pending a timing run on the full approximately 465-item set. This 12-photo run cannot establish whether face detection makes the people step too slow.",
        "",
      ];
      await mkdir(path.dirname(timingsPath), { recursive: true });
      await writeFile(timingsPath, rows.join("\n"));
      throw new Error(`BACKLOG 18 replay mismatch; missing exact request keys: ${keys.join(", ") || "none (same-stage fallback was used)"}`);
    }
  }

  await expect(page.getByText("Any moments that must be in the film")).toBeVisible({ timeout: 180_000 });
  await screenshot(page, 6);

  await page.getByRole("button", { name: /Moment .*$/ }).first().click();
  await page.getByRole("button", { name: "Done" }).click();
  try {
    await expect(page.getByRole("button", { name: "Sounds good. Shape it." })).toBeVisible({ timeout: 120_000 });
  } catch (error) {
    if (apiFailures.length) console.log("API requests returned errors:", apiFailures.join("; "));
    throw error;
  }
  await screenshot(page, 7);

  await page.getByRole("button", { name: "Sounds good. Shape it." }).click();
  await screenshot(page, 8);
  const save = page.getByRole("button", { name: "Save film" });
  try {
    await expect(save).toBeVisible({ timeout: 300_000 });
  } catch (error) {
    if (missingKeys.length) throw new Error("Replay fixture missing request key: " + missingKeys.at(-1));
    throw error;
  }
  readyAt.film = Date.now();
  await screenshot(page, 9);

  await page.getByRole("button", { name: "Save film" }).click();
  await expect(page.getByText("Saved to your films")).toBeVisible({ timeout: 300_000 });
  await screenshot(page, 10);
  const savedScreen = await page.locator("body").innerText();
  await page.reload();
  await expect(page.getByText("Saved to your films")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("button", { name: "Back to your films" })).toBeVisible();
  expect(await page.locator("body").innerText()).toContain(savedScreen.slice(-50));
  await screenshot(page, 11);
  await page.getByRole("button", { name: "Back to your films" }).click();
  await expect(page.getByRole("heading", { name: "Your films" })).toBeVisible();
  await screenshot(page, 12);
  await expect(page.getByText("Just saved").first()).toBeVisible();
  await screenshot(page, 13);

  if (!projectIdForChat || !authForChat || !summaryForChat) throw new Error("Could not capture the authenticated project context for chat interpretation checks.");
  const examples = [
    { step: "occasion", text: "it's grandma's 70th, not a trip" },
    { step: "people", text: "the girl in pink is Mia" },
    { step: "moments", text: "the snow monkeys must be in" },
    { step: "direction", text: "more upbeat, and shorter" },
  ] as const;
  const recordedExamples: { step: string; text: string; recordedKind: string }[] = [];
  for (const example of examples) {
    const response = await page.request.post(`http://127.0.0.1:8095/api/projects/${projectIdForChat}/chat/interpret`, {
      headers: { Authorization: authForChat },
      data: { step: example.step, text: example.text, context: { summary: summaryForChat, people: [] } },
    });
    if (!response.ok()) throw new Error(`chat interpretation recording returned HTTP ${response.status()} for step ${example.step}`);
    const result = await response.json() as { change?: { kind?: string } };
    expect(result.change?.kind, `${example.step} example should return a recorded interpretation`).toBeTruthy();
    recordedExamples.push({ ...example, recordedKind: result.change!.kind! });
  }
  await writeFile(replayInputPath, JSON.stringify({ projectId: projectIdForChat, authorization: authForChat, summary: summaryForChat, examples: recordedExamples }), { mode: 0o600 });
  console.log("Recorded and validated four chat interpretation examples.");

  const rows = ["# Director chat timing — trip1", "", "Measured from starting upload. Readiness milestones come from the project summary endpoint; film ready is the first visible Save film action.", "", `Local trip1 fixture set: ${trip1Files.length} photos.`, ""];
  for (const key of ["summary", "faces", "plan", "film"] as const) rows.push(`- Upload to ${key === "film" ? "film ready" : `${key} ready`}: ${readyAt[key] === undefined ? "not observed" : ((readyAt[key]! - uploadStartedAt) / 1000).toFixed(1) + " s"}`);
  rows.push("", "Recommendation on D3: keep the director chat non-blocking; the UI should explain what is still processing while summary, face groups, and the plan become ready.", "");
  await mkdir(path.dirname(timingsPath), { recursive: true });
  await writeFile(timingsPath, rows.join("\n"));
});
