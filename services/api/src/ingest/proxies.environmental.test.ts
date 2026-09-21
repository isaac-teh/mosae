import { describe, expect, it, vi } from "vitest";
import { PermanentIngestError } from "./errors.js";

const sharpMock = vi.hoisted(() => vi.fn());
vi.mock("sharp", () => ({ default: sharpMock }));

import { makePhotoDerivatives } from "./proxies.js";

describe("makePhotoDerivatives sharp failures", () => {
  it("rethrows a sharp resource failure for task retry", async () => {
    sharpMock.mockImplementation(() => { throw Object.assign(new Error("Cannot allocate memory"), { code: "ENOMEM" }); });
    await expect(makePhotoDerivatives("input.jpg", "out")).rejects.not.toBeInstanceOf(PermanentIngestError);
  });

  it("keeps a sharp unsupported input permanent", async () => {
    sharpMock.mockImplementation(() => { throw new Error("Input file contains unsupported image format"); });
    const run = async () => Promise.reject(Object.assign(new Error("command failed"), { code: 1 }));
    await expect(makePhotoDerivatives("input.jpg", "out", run)).rejects.toMatchObject({ reason: "unsupported_image" });
  });
});
