import { describe, expect, it } from "vitest";
import { shouldAutoScrollAfterAction } from "../lib/chatScroll";

describe("director chat scroll intent", () => {
  it("follows new content while a user action is active", () => {
    expect(shouldAutoScrollAfterAction(true, false)).toBe(true);
  });

  it("does not follow background content after the user scrolls up", () => {
    expect(shouldAutoScrollAfterAction(true, true)).toBe(false);
    expect(shouldAutoScrollAfterAction(false, false)).toBe(false);
  });
});
