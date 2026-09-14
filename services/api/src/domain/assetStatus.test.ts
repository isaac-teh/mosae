import { describe, it, expect } from "vitest";
import { canTransition } from "./assetStatus.js";

describe("asset status transitions", () => {
  it("moves forward through the pipeline", () => {
    expect(canTransition(null, "uploaded")).toBe(true);
    expect(canTransition("uploaded", "ingested")).toBe(true);
    expect(canTransition("ingested", "understood")).toBe(true);
    expect(canTransition("uploaded", "failed")).toBe(true);
  });

  it("never regresses or leaves terminal states", () => {
    expect(canTransition("ingested", "uploaded")).toBe(false);
    expect(canTransition("understood", "ingested")).toBe(false);
    expect(canTransition("failed", "ingested")).toBe(false);
    expect(canTransition("understood", "failed")).toBe(false);
  });

  it("allows re-marking uploaded for a newer generation", () => {
    expect(canTransition("uploaded", "uploaded")).toBe(true);
  });
});
