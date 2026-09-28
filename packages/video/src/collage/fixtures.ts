import { COLLAGE_LAYOUTS, type CollageSpec, slotCountForLayout } from "./schema";

export const PLACEHOLDER_PHOTOS = ["/photos/photo-a.svg", "/photos/photo-b.svg", "/photos/photo-c.svg", "/photos/photo-d.svg", "/photos/photo-e.svg", "/photos/photo-f.svg"];

export function createCollageSpec(layoutId: CollageSpec["layoutId"], overrides: Partial<CollageSpec> = {}): CollageSpec {
  const count = slotCountForLayout(layoutId);
  return {
    layoutId,
    slots: Array.from({ length: count }, (_, i) => ({ slotId: `slot-${i + 1}`, src: PLACEHOLDER_PHOTOS[i % PLACEHOLDER_PHOTOS.length] })),
    motionId: "print-drop",
    effectId: null,
    seed: `mosae-${layoutId}`,
    durationSec: 3,
    caption: { place: "Kyoto · Japan", date: "AUTUMN 2026", headline: "Postcards from Kyoto", subline: "A small collection of places" },
    ...overrides,
  };
}

export const COLLAGE_LAYOUT_IDS = COLLAGE_LAYOUTS.map((layout) => layout.id);
