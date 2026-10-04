import { describe, expect, it } from "vitest";
import { trimRange, videoTrimBounds } from "./timelineTrim";

describe("timeline trim math", () => {
  it("trims the left edge", () => {
    expect(trimRange({ startSec: 2, endSec: 5, edge: "start", requestedSec: 3, minSec: 0, maxSec: 8 }))
      .toEqual({ startSec: 3, endSec: 5 });
  });

  it("trims the right edge", () => {
    expect(trimRange({ startSec: 2, endSec: 5, edge: "end", requestedSec: 7, minSec: 0, maxSec: 8 }))
      .toEqual({ startSec: 2, endSec: 7 });
  });

  it("clamps each edge to a half-second minimum", () => {
    expect(trimRange({ startSec: 4, endSec: 5, edge: "start", requestedSec: 4.9, minSec: 0, maxSec: 8 }))
      .toEqual({ startSec: 4.5, endSec: 5 });
    expect(trimRange({ startSec: 4, endSec: 5, edge: "end", requestedSec: 4.1, minSec: 0, maxSec: 8 }))
      .toEqual({ startSec: 4, endSec: 4.5 });
  });

  it("clamps video edges to the original source bounds", () => {
    expect(trimRange({ startSec: 4, endSec: 6, edge: "start", requestedSec: 0, minSec: 3, maxSec: 7 }))
      .toEqual({ startSec: 3, endSec: 6 });
    expect(trimRange({ startSec: 4, endSec: 6, edge: "end", requestedSec: 10, minSec: 3, maxSec: 7 }))
      .toEqual({ startSec: 4, endSec: 7 });
  });

  it("uses a replaced video's available source start and end", () => {
    expect(videoTrimBounds({ sourceInSec: 4, sourceOutSec: 5, sourceStartSec: 3, sourceEndSec: 7, sourceDurationSec: 12 }))
      .toEqual({ minSec: 3, maxSec: 7 });
  });
});
