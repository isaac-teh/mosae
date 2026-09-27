import { describe, it, expect } from "vitest";
import { holdsFor, craftBrief } from "./brief.js";
import { CADENCES } from "@mosae/contracts";

describe("holdsFor", () => {
  it.each(CADENCES.map(c => [c.id]))(
    "resolves for cadence %s",
    (cadenceId: string) => {
      const holds = holdsFor(cadenceId as Parameters<typeof holdsFor>[0]);
      expect(holds).toBeDefined();
      expect(typeof holds.base).toBe("number");
      expect(typeof holds.min).toBe("number");
      expect(typeof holds.max).toBe("number");
      expect(holds.min).toBeLessThanOrEqual(holds.base);
      expect(holds.max).toBeGreaterThanOrEqual(holds.base);
    },
  );

  it("keeps every cadence inside 1–5s", () => {
    for (const { id } of CADENCES) {
      const h = holdsFor(id);
      expect(h.min).toBeGreaterThanOrEqual(1);
      expect(h.max).toBeLessThanOrEqual(5);
      expect(h.base).toBeGreaterThanOrEqual(h.min);
      expect(h.base).toBeLessThanOrEqual(h.max);
    }
  });

  it("tender holds match the table", () => {
    const h = holdsFor("tender" as any);
    expect(h.base).toBe(4);
    expect(h.min).toBe(2.5);
    expect(h.max).toBe(5);
  });

  it("energetic has the shortest holds", () => {
    const h = holdsFor("energetic" as any);
    expect(h.base).toBe(1.5);
    expect(h.min).toBe(1);
    expect(h.max).toBe(2.5);
  });
});

describe("craftBrief", () => {
  it("includes rhythm section with correct hold values for tender", () => {
    const brief = craftBrief("tender" as any, 60);
    expect(brief).toContain("Rhythm");
    expect(brief).toContain("4s");
    expect(brief).toContain("2.5s");
    expect(brief).toContain("5s");
    expect(brief).toContain("60s");
  });

  it("includes rhythm section with correct hold values for energetic", () => {
    const brief = craftBrief("energetic" as any, 30);
    expect(brief).toContain("1.5s");
    expect(brief).toContain("1s");
    expect(brief).toContain("2.5s");
    expect(brief).toContain("30s");
  });

  it("includes all required sections", () => {
    const brief = craftBrief("reflective" as any, 120);
    expect(brief).toContain("Rhythm");
    expect(brief).toContain("Motion");
    expect(brief).toContain("Trimming video");
    expect(brief).toContain("Order");
    expect(brief).toContain("Transitions");
    expect(brief).toContain("Text");
    expect(brief).toContain("Audio");
  });

  it("includes the opening judgment line", () => {
    const brief = craftBrief("playful" as any, 60);
    expect(brief).toContain("Judge it as film, not as a gallery");
  });

  it("varies holds to avoid slideshow reading", () => {
    const brief = craftBrief("celebratory" as any, 90);
    expect(brief).toContain("Three shots of identical length in a row reads as a slideshow");
  });

  it("targets the correct duration", () => {
    const targetSecs = [30, 60, 120, 180, 300];
    for (const sec of targetSecs) {
      const brief = craftBrief("tender" as any, sec);
      expect(brief).toContain(`${sec}s`);
    }
  });

  it("cadence name appears in mood line", () => {
    const brief = craftBrief("reflective" as any, 60);
    expect(brief).toContain('Mood "Reflective"');
  });
});
