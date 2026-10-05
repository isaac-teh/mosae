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
import { PhotoInteraction } from "../PhotoInteraction";
import { CellInteraction } from "./CellInteraction";
import { focusRelayInputRange } from "./CollageBase";
import { ALLOWED_COMBOS, ALLOWED_COMBO_KEYS } from "./allowedCombos";
import { CollageSpecSchema, COLLAGE_LAYOUTS, COLLAGE_MOTIONS, COLLAGE_EFFECTS, COLLAGE_GRID_VARIANTS, collageGridRects, slotCountForLayout } from "./schema";
import { createCollageSpec } from "./fixtures";

describe("CollageSpec", () => {
  it("uses six distinct normalized non-overlapping grid geometries at 2, 3, and 4 photos", () => {
    for (const count of [2, 3, 4]) {
      const signatures = COLLAGE_GRID_VARIANTS.map(({ id }) => {
        const rects = collageGridRects(id, count);
        expect(rects).toHaveLength(count);
        for (const rect of rects) {
          expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.w).toBeLessThanOrEqual(100.001); expect(rect.y + rect.h).toBeLessThanOrEqual(100.001);
        }
        for (let i=0;i<rects.length;i++) for (let j=i+1;j<rects.length;j++) {
          const a=rects[i]!, b=rects[j]!;
          expect(a.x+a.w <= b.x || b.x+b.w <= a.x || a.y+a.h <= b.y || b.y+b.h <= a.y).toBe(true);
        }
        const area=rects.reduce((sum,rect)=>sum+rect.w*rect.h,0);
        expect(area).toBeGreaterThan(90);
        return JSON.stringify(rects);
      });
      expect(new Set(signatures).size).toBe(6);
    }
  });
  it("excludes both Film negative motions from the reviewed library", () => {
    expect(ALLOWED_COMBOS.map((combo) => combo.layoutId)).not.toContain("film-negative");
    expect(COLLAGE_LAYOUTS.map((layout) => layout.id)).not.toContain("film-negative");
  });
  it("retains the selected and rebuilt reference layout-motion combinations", () => {
    expect(ALLOWED_COMBOS.filter((combo) => ["travel-mosaic", "travel-story", "nine-photo-grid", "botanical-scrapbook"].includes(combo.layoutId))).toEqual([
      { layoutId: "travel-mosaic", motionId: "print-drop" },
      { layoutId: "travel-story", motionId: "focus-relay" },
      { layoutId: "botanical-scrapbook", motionId: "tape-slap" },
      { layoutId: "nine-photo-grid", motionId: "print-drop" },
    ]);
    for (const [id, count] of [["travel-mosaic", 8], ["travel-story", 5], ["botanical-scrapbook", 4], ["nine-photo-grid", 9]] as const) {
      const layout = COLLAGE_LAYOUTS.find((item) => item.id === id);
      expect(layout?.preferredSlots).toBe(count);
      const markup = renderToStaticMarkup(<Collage spec={createCollageSpec(id)} />);
      expect((markup.match(/<img /g) ?? []).length).toBe(count);
    }
  });
  it("renders one-photo and two-photo layouts without changing their slot counts", () => {
    for (const [id, count] of [["single-photo", 1], ["two-photo-diptych", 2]] as const) {
      const spec = createCollageSpec(id);
      expect(spec.slots).toHaveLength(count);
      expect(CollageSpecSchema.safeParse(spec).success).toBe(true);
      const markup = renderToStaticMarkup(<Collage spec={spec} />);
      expect((markup.match(/data-collage-cell=/g) ?? []).length).toBe(0);
    }
  });
  it("exposes a selected single photo crop surface with pan, zoom, and rotation gestures", () => {
    const markup = renderToStaticMarkup(<PhotoInteraction clipId="photo-1" selected onSelect={() => {}} onCommit={() => {}} />);
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("touch-action:none");
    expect(markup).toContain("#f38a5b");
    expect(markup).toContain("12px solid #f38a5b");
  });
  it("renders no photo or collage interaction layer when editor handlers are absent", () => {
    expect(renderToStaticMarkup(<PhotoInteraction clipId="photo-1" />)).toBe("");
    expect(renderToStaticMarkup(<CellInteraction clipId="collage-1" slotId="slot-1" />)).toBe("");
  });
  it("renders photo and collage interaction layers when editor handlers are provided", () => {
    expect(renderToStaticMarkup(<PhotoInteraction clipId="photo-1" onSelect={() => {}} />)).toContain('data-photo-clip="photo-1"');
    expect(renderToStaticMarkup(<CellInteraction clipId="collage-1" slotId="slot-1" onSelect={() => {}} />)).toContain('data-collage-cell="collage-1:slot-1"');
  });
  it("renders selected collage cells in blue and provides replaceable empty cells", () => {
    const spec = { ...createCollageSpec("photo-table"), slots: createCollageSpec("photo-table").slots.map((slot, index) => index === 0 ? { slotId: slot.slotId, kind: "photo" as const, empty: true as const } : slot) };
    const markup = renderToStaticMarkup(<Collage spec={spec} selectedCollageCellId={`:${spec.slots[0]!.slotId}`} onSelectCollageCell={() => {}} />);
    expect(markup).toContain("Add photo");
    expect(markup).toContain("#168dff");
    expect(markup).toContain("12px solid #168dff");
  });
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
    expect(ALLOWED_COMBOS.filter(({ layoutId }) => !["single-photo", "two-photo-diptych", ...COLLAGE_GRID_VARIANTS.map(({ id }) => id)].includes(layoutId)).map(({ layoutId, motionId }) => `${layoutId}::${motionId}`).sort()).toEqual(reviewedKeeps);

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

  it("keeps Travel story free of all template caption text", () => {
    const markup = renderToStaticMarkup(<Collage spec={createCollageSpec("travel-story")} />);
    for (const text of ["Postcards from Kyoto", "A small collection of places", "Kyoto · Japan", "AUTUMN 2026"]) expect(markup).not.toContain(text);
    expect(markup).not.toContain("linear-gradient(transparent,rgba(0,0,0,.35))");
  });

  it("produces identical markup for identical props and seed", () => {
    const spec = createCollageSpec("photo-table");
    expect(renderToStaticMarkup(<Collage spec={spec} />)).toBe(renderToStaticMarkup(<Collage spec={spec} />));
    expect(renderToStaticMarkup(<Collage spec={{ ...spec, seed: "different-seed" }} />)).not.toBe(renderToStaticMarkup(<Collage spec={spec} />));
  });

  it("renders a chapter place caption without a date or separator", () => {
    const spec = { ...createCollageSpec("torn-paper"), caption: { place: "Day 1 · Siloso Beach" } };
    const markup = renderToStaticMarkup(<Collage spec={spec} />);
    expect(markup).toContain("Day 1 · Siloso Beach");
    expect(markup).not.toContain("AUTUMN 2026");
    expect(markup).not.toMatch(/·\s*<\/div>/);
  });

  it("omits the caption footer entirely when no user caption is supplied", () => {
    const markup = renderToStaticMarkup(<Collage spec={createCollageSpec("torn-paper", { caption: undefined })} />);
    expect(markup).not.toContain("background:rgba(250,250,247,.94)");
    expect(markup).not.toContain("box-shadow:0 2px 9px rgba(18,26,30,.18)");
  });

  it("keeps focus-relay input ranges strictly increasing through the final slot", () => {
    const finalSixSlotRange = focusRelayInputRange(5, 6);
    expect(finalSixSlotRange).toEqual([expect.any(Number), expect.any(Number), 1]);
    expect(finalSixSlotRange[0]).toBeLessThan(finalSixSlotRange[1]);
    expect(finalSixSlotRange[1]).toBeLessThan(finalSixSlotRange[2]);
  });
});
