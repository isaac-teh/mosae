export const ALLOWED_COMBOS = [
  { layoutId: "photo-table", motionId: "stack-deal" },
  { layoutId: "photo-table", motionId: "page-turn" },
  { layoutId: "torn-paper", motionId: "print-drop" },
  { layoutId: "torn-paper", motionId: "tape-slap" },
  { layoutId: "torn-paper", motionId: "crash-zoom" },
  { layoutId: "polaroid-garland", motionId: "page-turn" },
  { layoutId: "polaroid-garland", motionId: "focus-relay" },
  { layoutId: "film-negative", motionId: "print-drop" },
  { layoutId: "film-negative", motionId: "page-turn" },
  { layoutId: "postcard-stack", motionId: "stack-deal" },
  { layoutId: "route-map", motionId: "stack-deal" },
] as const;

export const ALLOWED_COMBO_KEYS = new Set(
  ALLOWED_COMBOS.map(({ layoutId, motionId }) => `${layoutId}::${motionId}`),
);
