import { describe, expect, it } from "vitest";
import { parseTimeline } from "@mosae/contracts";
import { fixtureTimeline } from "./fixtureTimeline.js";

describe("fixtureTimeline", () => {
  it("continues to satisfy the shared Timeline contract", () => {
    expect(parseTimeline(fixtureTimeline)).toEqual(fixtureTimeline);
  });
});
