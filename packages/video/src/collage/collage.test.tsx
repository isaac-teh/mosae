import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children, style }: React.PropsWithChildren<{ style?: React.CSSProperties }>) => <div style={style}>{children}</div>,
  Img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
  useCurrentFrame: () => 14,
  useVideoConfig: () => ({ fps: 30, width: 360, height: 640, durationInFrames: 90 }),
  interpolate: (value: number, input: number[], output: number[]) => {
    const progress = Math.min(1, Math.max(0, (value - input[0]) / (input[input.length - 1] - input[0] || 1)));
    const index = Math.min(output.length - 2, Math.floor(progress * (output.length - 1)));
    const part = progress * (output.length - 1) - index;
    return output[index] + (output[index + 1] - output[index]) * part;
  },
  random: (key: string) => { let n = 2166136261; for (const char of key) n = Math.imul(n ^ char.charCodeAt(0), 16777619); return (n >>> 0) / 4294967296; },
  spring: ({ frame }: { frame: number }) => Math.min(1, Math.max(0, frame / 30)),
}));

import { Collage } from "./Collage";
import { ALLOWED_COMBOS, ALLOWED_COMBO_KEYS } from "./allowedCombos";
import { CollageSpecSchema, COLLAGE_LAYOUTS, COLLAGE_MOTIONS, COLLAGE_EFFECTS, slotCountForLayout } from "./schema";
import { createCollageSpec } from "./fixtures";

describe("CollageSpec", () => {
  it("accepts shot ID and URL slot sources, and rejects missing or competing sources", () => {
    const spec = createCollageSpec("route-map");
    expect(CollageSpecSchema.safeParse(spec).success).toBe(true);
    expect(CollageSpecSchema.safeParse({ ...spec, slots: [{ slotId: "a" }] }).success).toBe(false);
    expect(CollageSpecSchema.safeParse({ ...spec, slots: [{ slotId: "a", shotId: "s", src: "p.svg" }] }).success).toBe(false);
  });

  it("enforces the declared slot count limits", () => {
    for (const layout of COLLAGE_LAYOUTS) {
      const valid = createCollageSpec(layout.id);
      expect(slotCountForLayout(layout.id)).toBeGreaterThanOrEqual(layout.minSlots);
      expect(slotCountForLayout(layout.id)).toBeLessThanOrEqual(layout.maxSlots);
      expect(CollageSpecSchema.safeParse(valid).success, layout.id).toBe(true);
      expect(CollageSpecSchema.safeParse({ ...valid, slots: valid.slots.slice(0, layout.minSlots - 1) }).success, layout.id).toBe(false);
      const atMaximum = [...valid.slots.slice(0, layout.minSlots), ...Array.from({ length: layout.maxSlots - layout.minSlots }, (_, i) => ({ slotId: `max-${i}`, src: "/extra.svg" }))];
      expect(CollageSpecSchema.safeParse({ ...valid, slots: atMaximum }).success, layout.id).toBe(true);
      expect(CollageSpecSchema.safeParse({ ...valid, slots: [...atMaximum, { slotId: "too-many", src: "/extra.svg" }] }).success, layout.id).toBe(false);
    }
  });

  it("matches the committed review JSON and rejects every unapproved layout-motion pair", () => {
    const reviewPath = resolve(process.cwd(), "../../docs/design/collage-review.json");
    const review = JSON.parse(readFileSync(reviewPath, "utf8")) as {
      combos: { layoutId: string; motionId: string; verdict: string }[];
    };
    const reviewedKeeps = review.combos.filter((combo) => combo.verdict === "keep")
      .map(({ layoutId, motionId }) => `${layoutId}::${motionId}`).sort();
    expect(ALLOWED_COMBOS.map(({ layoutId, motionId }) => `${layoutId}::${motionId}`).sort()).toEqual(reviewedKeeps);

    for (const layout of COLLAGE_LAYOUTS) for (const motion of COLLAGE_MOTIONS) {
      const spec = createCollageSpec(layout.id, { motionId: motion.id });
      const shouldBeAllowed = ALLOWED_COMBO_KEYS.has(`${layout.id}::${motion.id}`);
      expect(CollageSpecSchema.safeParse(spec).success, `${layout.id}/${motion.id}`).toBe(shouldBeAllowed);
    }
  });
});

describe("Collage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders every approved combination and effect to markup", () => {
    for (const combo of ALLOWED_COMBOS) for (const effect of COLLAGE_EFFECTS) {
      const spec = { ...createCollageSpec(combo.layoutId), motionId: combo.motionId, effectId: effect.id };
      expect(() => renderToStaticMarkup(<Collage spec={spec} />), `${combo.layoutId}/${combo.motionId}/${effect.id}`).not.toThrow();
    }
  });

  it("produces identical markup for identical props and seed", () => {
    const spec = createCollageSpec("photo-table");
    expect(renderToStaticMarkup(<Collage spec={spec} />)).toBe(renderToStaticMarkup(<Collage spec={spec} />));
    expect(renderToStaticMarkup(<Collage spec={{ ...spec, seed: "different-seed" }} />)).not.toBe(renderToStaticMarkup(<Collage spec={spec} />));
  });
});
