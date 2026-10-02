export const ALLOWED_COMBOS = [
  { layoutId: "single-photo", motionId: "print-drop" },
  { layoutId: "two-photo-diptych", motionId: "print-drop" },
  { layoutId: "grid-wide-top", motionId: "print-drop" },
  { layoutId: "grid-wide-bottom", motionId: "print-drop" },
  { layoutId: "grid-stacked-rows", motionId: "print-drop" },
  { layoutId: "grid-tall-left", motionId: "print-drop" },
  { layoutId: "grid-tall-right", motionId: "print-drop" },
  { layoutId: "grid-three-columns", motionId: "print-drop" },
  { layoutId: "travel-mosaic", motionId: "print-drop" },
  { layoutId: "travel-story", motionId: "focus-relay" },
  { layoutId: "botanical-scrapbook", motionId: "tape-slap" },
  { layoutId: "nine-photo-grid", motionId: "print-drop" },

  { layoutId: "photo-table", motionId: "stack-deal" },
  { layoutId: "photo-table", motionId: "page-turn" },
  { layoutId: "torn-paper", motionId: "print-drop" },
  { layoutId: "torn-paper", motionId: "tape-slap" },
  { layoutId: "torn-paper", motionId: "crash-zoom" },
  { layoutId: "polaroid-garland", motionId: "page-turn" },
  { layoutId: "polaroid-garland", motionId: "focus-relay" },
  { layoutId: "postcard-stack", motionId: "stack-deal" },
  { layoutId: "route-map", motionId: "stack-deal" },
] as const;

export const ALLOWED_COMBO_KEYS = new Set(
  ALLOWED_COMBOS.map(({ layoutId, motionId }) => `${layoutId}::${motionId}`),
);
