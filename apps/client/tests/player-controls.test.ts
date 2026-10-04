import { describe, expect, it } from "vitest";
import { formatFilmTime, fullscreenMode, seekTimeAtPosition } from "../components/player-controls";

describe("player controls", () => {
  it("uses native fullscreen before video webkit fullscreen, then overlay", () => {
    expect(fullscreenMode({ requestFullscreen() {} }, { webkitEnterFullscreen() {} })).toBe("native");
    expect(fullscreenMode({}, { webkitEnterFullscreen() {} })).toBe("webkit");
    expect(fullscreenMode({}, null)).toBe("overlay");
  });

  it("maps tap and drag positions to a clamped seek time", () => {
    expect(seekTimeAtPosition(75, 0, 100, 40)).toBe(30);
    expect(seekTimeAtPosition(-5, 0, 100, 40)).toBe(0);
    expect(seekTimeAtPosition(105, 0, 100, 40)).toBe(40);
  });

  it("formats film time labels as minutes and seconds", () => {
    expect(formatFilmTime(0)).toBe("00:00");
    expect(formatFilmTime(65.9)).toBe("01:05");
    expect(formatFilmTime(-1)).toBe("00:00");
  });
});
