import { describe, expect, it } from "vitest";
import { isDecodeFailure, isEnvironmental, isToolRejection } from "./errorClass.js";

describe("ingest error classification", () => {
  it("recognises environmental process failures", () => {
    expect(isEnvironmental({ killed: true })).toBe(true);
    expect(isEnvironmental({ signal: "SIGKILL" })).toBe(true);
    expect(isEnvironmental({ code: "ENOMEM" })).toBe(true);
  });
  it("recognises tool input rejections but not environmental failures", () => {
    expect(isToolRejection({ code: 1, message: "bad file" })).toBe(true);
    expect(isToolRejection({ code: "ENOMEM" })).toBe(false);
  });
  it("recognises decode failures only", () => {
    expect(isDecodeFailure(new Error("Input file contains unsupported image format"))).toBe(true);
    expect(isDecodeFailure(new Error("boom"))).toBe(false);
  });
});
