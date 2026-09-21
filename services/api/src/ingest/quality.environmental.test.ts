import { describe, expect, it, vi } from "vitest";
import { PermanentIngestError } from "./errors.js";

const sharpMock = vi.hoisted(() => vi.fn());
vi.mock("sharp", () => ({ default: sharpMock }));

import { analyzeImage } from "./quality.js";

describe("analyzeImage sharp failures", () => {
  it("rethrows a sharp resource failure for task retry", async () => {
    sharpMock.mockImplementation(() => { throw Object.assign(new Error("Cannot allocate memory"), { code: "ENOMEM" }); });
    await expect(analyzeImage("input.jpg")).rejects.not.toBeInstanceOf(PermanentIngestError);
  });

  it("keeps a sharp unsupported input permanent", async () => {
    sharpMock.mockImplementation(() => { throw new Error("Input file contains unsupported image format"); });
    await expect(analyzeImage("input.jpg")).rejects.toMatchObject({ reason: "unsupported_image" });
  });
});
