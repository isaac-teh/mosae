import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCastLabels } from "./ensureCast.js";

let tempDirectory: string | undefined;

afterEach(async () => {
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
  tempDirectory = undefined;
});

describe("loadCastLabels", () => {
  it("returns no labels when the fixture directory is missing", async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), "mosae-cast-labels-"));
    await expect(loadCastLabels([], join(tempDirectory, "missing"))).resolves.toBeUndefined();
  });
});
