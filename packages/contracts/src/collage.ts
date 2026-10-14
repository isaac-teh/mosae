import { z } from "zod";
import { ALLOWED_COMBO_KEYS } from "./collageCombos.js";

export function isApprovedCollageCombination(layoutId: string, motionId: string): boolean {
  return ALLOWED_COMBO_KEYS.has(`${layoutId}::${motionId}`);
}

export const COLLAGE_LAYOUTS = [
  { id: "simple-full", label: "Full-bleed", minSlots: 1, maxSlots: 1, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 1 },
  { id: "simple-centered", label: "Centered photo", minSlots: 1, maxSlots: 1, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 1 },
  { id: "simple-stacked", label: "Two stacked", minSlots: 2, maxSlots: 2, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 2 },
  { id: "simple-offset", label: "Two offset", minSlots: 2, maxSlots: 2, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 2 },
  { id: "simple-three-stacked", label: "Three stacked rows", minSlots: 3, maxSlots: 3, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "simple-three-top", label: "One big top + two", minSlots: 3, maxSlots: 3, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "simple-three-bottom", label: "Two top + one big bottom", minSlots: 3, maxSlots: 3, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "simple-grid-2x2", label: "2 × 2 grid", minSlots: 4, maxSlots: 4, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 4 },
  { id: "simple-five-top", label: "Big top + four", minSlots: 5, maxSlots: 5, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 5 },
  { id: "simple-five-middle", label: "Big middle", minSlots: 5, maxSlots: 5, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 5 },
  { id: "simple-five-bottom", label: "Big bottom + four", minSlots: 5, maxSlots: 5, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 5 },
  { id: "simple-grid-2x3", label: "2 × 3 grid", minSlots: 6, maxSlots: 6, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 6 },
  { id: "design-polaroid", label: "Polaroid", minSlots: 1, maxSlots: 6, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "design-magazine", label: "Magazine", minSlots: 1, maxSlots: 6, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "design-film-strip", label: "Film strip", minSlots: 1, maxSlots: 6, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "single-photo", label: "Single photo", minSlots: 1, maxSlots: 1, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 1 },
  { id: "two-photo-diptych", label: "Two-photo diptych", minSlots: 2, maxSlots: 2, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 2 },
  { id: "grid-wide-top", label: "Wide top + two bottom", minSlots: 1, maxSlots: 9, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "grid-wide-bottom", label: "Two top + wide bottom", minSlots: 1, maxSlots: 9, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "grid-stacked-rows", label: "Three stacked rows", minSlots: 1, maxSlots: 9, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "grid-tall-left", label: "Tall left + two right", minSlots: 1, maxSlots: 9, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "grid-tall-right", label: "Two left + tall right", minSlots: 1, maxSlots: 9, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "grid-three-columns", label: "Three columns", minSlots: 1, maxSlots: 9, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "botanical-scrapbook", label: "Botanical scrapbook", minSlots: 3, maxSlots: 6, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 4 },
  { id: "nine-photo-grid", label: "Nine-photo grid", minSlots: 3, maxSlots: 9, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 9 },
  { id: "travel-mosaic", label: "Travel mosaic", minSlots: 3, maxSlots: 8, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 8 },
  { id: "travel-story", label: "Travel story", minSlots: 3, maxSlots: 6, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 5 },
  { id: "photo-table", label: "Photo table", minSlots: 4, maxSlots: 6, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 6 },
  { id: "torn-paper", label: "Torn paper mosaic", minSlots: 3, maxSlots: 5, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 4 },
  { id: "polaroid-garland", label: "Polaroid garland", minSlots: 3, maxSlots: 5, aspect: ["9:16"], maxVideoCells: 1, preferredSlots: 4 },
  { id: "postcard-stack", label: "Postcard stack", minSlots: 3, maxSlots: 5, aspect: ["9:16"], maxVideoCells: 1, preferredSlots: 4 },
  { id: "route-map", label: "Route map", minSlots: 3, maxSlots: 5, aspect: ["9:16"], maxVideoCells: 1, preferredSlots: 4 },
] as const;

export const COLLAGE_GRID_VARIANTS = [
  { id: "simple-full", label: "Full-bleed" },
  { id: "simple-centered", label: "Centered photo" },
  { id: "simple-stacked", label: "Two stacked" },
  { id: "simple-offset", label: "Two offset" },
  { id: "simple-three-stacked", label: "Three stacked rows" },
  { id: "simple-three-top", label: "One big top + two" },
  { id: "simple-three-bottom", label: "Two top + one big bottom" },
  { id: "simple-grid-2x2", label: "2 × 2 grid" },
  { id: "simple-five-top", label: "Big top + four" },
  { id: "simple-five-middle", label: "Big middle" },
  { id: "simple-five-bottom", label: "Big bottom + four" },
  { id: "simple-grid-2x3", label: "2 × 3 grid" },
  { id: "grid-wide-top", label: "Wide top + two bottom" },
  { id: "grid-wide-bottom", label: "Two top + wide bottom" },
  { id: "grid-stacked-rows", label: "Three stacked rows" },
  { id: "grid-tall-left", label: "Tall left + two right" },
  { id: "grid-tall-right", label: "Two left + tall right" },
  { id: "grid-three-columns", label: "Three columns" },
] as const;

export const COLLAGE_MOTIONS = [
  { id: "print-drop", label: "Print drop" },
  { id: "stack-deal", label: "Stack deal" },
  { id: "page-turn", label: "Page turn" },
  { id: "tape-slap", label: "Tape slap" },
  { id: "crash-zoom", label: "Crash zoom" },
  { id: "focus-relay", label: "Focus relay" },
] as const;

export const COLLAGE_EFFECTS = [
  { id: "vignette", label: "Vignette" },
  { id: "warm-grade", label: "Warm grade" },
  { id: "film-grain", label: "Film grain" },
  { id: "light-leak", label: "Light leak" },
] as const;

const motionIds = COLLAGE_MOTIONS.map((item) => item.id) as [
  (typeof COLLAGE_MOTIONS)[number]["id"],
  ...(typeof COLLAGE_MOTIONS)[number]["id"][],
];
const effectIds = COLLAGE_EFFECTS.map((item) => item.id) as [
  (typeof COLLAGE_EFFECTS)[number]["id"],
  ...(typeof COLLAGE_EFFECTS)[number]["id"][],
];

const slotSchema = z.strictObject({
  slotId: z.string().min(1),
  shotId: z.string().min(1).optional(),
  src: z.string().min(1).optional(),
  kind: z.enum(["photo", "video"]).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  empty: z.literal(true).optional(),
  /** True only for an explicit user crop; automatic focus crops stay recomputable. */
  manualCrop: z.literal(true).optional(),
  crop: z.strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    scale: z.number().min(1).max(4),
    rotationDeg: z.number().finite().min(-180).max(180).optional(),
  }).optional(),
}).refine((slot) => slot.empty ? !slot.shotId && !slot.src : Boolean(slot.shotId) !== Boolean(slot.src), "provide one source or mark the slot empty");

export const CollageSpecSchema = z.strictObject({
  layoutId: z.enum(COLLAGE_LAYOUTS.map((layout) => layout.id) as [
    (typeof COLLAGE_LAYOUTS)[number]["id"],
    ...(typeof COLLAGE_LAYOUTS)[number]["id"][],
  ]),
  slots: z.array(slotSchema),
  motionId: z.enum(motionIds),
  effectId: z.enum(effectIds).nullable(),
  seed: z.string(),
  durationSec: z.number().finite().positive(),
  caption: z.strictObject({
    place: z.string().optional(),
    date: z.string().optional(),
    headline: z.string().optional(),
    subline: z.string().optional(),
  }).optional(),
}).superRefine((spec, ctx) => {
  const layout = COLLAGE_LAYOUTS.find((item) => item.id === spec.layoutId)!;
  if (spec.slots.length < layout.minSlots || spec.slots.length > layout.maxSlots) {
    ctx.addIssue({ code: "custom", path: ["slots"], message: `${layout.id} requires ${layout.minSlots}–${layout.maxSlots} slots` });
  }
  if (!isApprovedCollageCombination(spec.layoutId, spec.motionId)) {
    ctx.addIssue({ code: "custom", path: ["motionId"], message: `${spec.layoutId} × ${spec.motionId} is not an approved collage combination` });
  }
  const slotIds = spec.slots.map((slot) => slot.slotId);
  if (new Set(slotIds).size !== slotIds.length) {
    ctx.addIssue({ code: "custom", path: ["slots"], message: "slotId values must be unique" });
  }
  if (spec.slots.filter((slot) => slot.kind === "video").length > layout.maxVideoCells) {
    const limit = layout.maxVideoCells === 1 ? "one" : layout.maxVideoCells;
    ctx.addIssue({ code: "custom", path: ["slots"], message: `at most ${limit} video cell${layout.maxVideoCells === 1 ? "" : "s"}` });
  }
});

export type CollageSpec = z.infer<typeof CollageSpecSchema>;
export type CollageSlot = CollageSpec["slots"][number];

export function slotCountForLayout(layoutId: CollageSpec["layoutId"]): number {
  return COLLAGE_LAYOUTS.find((layout) => layout.id === layoutId)!.preferredSlots;
}
