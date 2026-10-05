import { expect, test } from "@playwright/test";
import path from "node:path";

test("keeps shown chat photo sources and nodes stable through upload completion", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page.getByRole("button", { name: /Create a new film/ }).click();
  await page.locator('input[type="file"]').setInputFiles([
    path.resolve("services/api/fixtures/demo/trip1-v2/photos/d1-01.jpg"),
    path.resolve("services/api/fixtures/demo/trip1-v2/photos/d1-02.jpg"),
    path.resolve("services/api/fixtures/demo/trip1-v2/photos/d1-03.jpg"),
  ]);
  await page.waitForURL("**/director?**", { timeout: 60_000 });

  await page.waitForFunction(() => [...document.images].some((image) => /^Selected photo|^Photo \d+/.test(image.alt)));
  await page.evaluate(() => {
    const tracked = new Set([...document.images].filter((image) => /^Selected photo|^Photo \d+/.test(image.alt)));
    const changes: { kind: "src" | "removed"; alt: string; src: string }[] = [];
    (window as any).__chatPhotoPreviewChanges = changes;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.attributeName === "src" && tracked.has(record.target as HTMLImageElement)) {
          const image = record.target as HTMLImageElement;
          changes.push({ kind: "src", alt: image.alt, src: image.src });
        }
        for (const node of [...record.removedNodes]) {
          if (node instanceof HTMLImageElement && tracked.has(node)) changes.push({ kind: "removed", alt: node.alt, src: node.src });
          if (node instanceof Element) for (const image of node.querySelectorAll("img")) if (tracked.has(image)) changes.push({ kind: "removed", alt: image.alt, src: image.src });
        }
        for (const node of [...record.addedNodes]) {
          if (node instanceof HTMLImageElement && /^Selected photo|^Photo \d+/.test(node.alt)) tracked.add(node);
          if (node instanceof Element) for (const image of node.querySelectorAll("img")) if (/^Selected photo|^Photo \d+/.test(image.alt)) tracked.add(image);
        }
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
    (window as any).__chatPhotoPreviewObserver = observer;
  });

  await expect(page.getByText(/I've looked through all 3/)).toBeVisible({ timeout: 210_000 });
  await page.waitForTimeout(1_000);
  const changes = await page.evaluate(() => {
    (window as any).__chatPhotoPreviewObserver.disconnect();
    return (window as any).__chatPhotoPreviewChanges as { kind: string; alt: string; src: string }[];
  });
  expect(changes.filter((change) => change.kind === "src")).toEqual([]);
  expect(changes.filter((change) => change.kind === "removed")).toEqual([]);
});
