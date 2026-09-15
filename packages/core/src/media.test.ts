import { describe, it, expect } from "vitest";
import { formatDuration, isMedia, mediaId } from "./media";

describe("media helpers", () => {
  it("accepts only image and video MIME types", () => {
    expect(isMedia(new File([], "a.jpg", { type: "image/jpeg" }))).toBe(true);
    expect(isMedia(new File([], "a.mov", { type: "video/quicktime" }))).toBe(true);
    expect(isMedia(new File([], "a.pdf", { type: "application/pdf" }))).toBe(false);
  });

  it("formats durations as m:ss with rounding", () => {
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(64.6)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("builds a stable id from name, size, and lastModified", () => {
    const file = new File([new Uint8Array(3)], "a.jpg", { type: "image/jpeg", lastModified: 42 });
    expect(mediaId(file)).toBe("a.jpg-3-42");
  });
});
