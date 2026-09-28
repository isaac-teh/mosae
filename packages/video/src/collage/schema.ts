import { z } from "zod";

export const COLLAGE_LAYOUTS = [
  { id: "photo-table", label: "Photo table", minSlots: 4, maxSlots: 6, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 6 },
  { id: "triptych", label: "Triptych", minSlots: 3, maxSlots: 3, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "hero-plus-two", label: "Hero + two", minSlots: 3, maxSlots: 3, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 3 },
  { id: "grid-4", label: "Grid of four", minSlots: 4, maxSlots: 4, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 4 },
  { id: "filmstrip", label: "Filmstrip", minSlots: 3, maxSlots: 6, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 5 },
  { id: "polaroid-stack", label: "Polaroid stack", minSlots: 3, maxSlots: 5, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 4 },
  { id: "split-screen", label: "Split screen", minSlots: 2, maxSlots: 2, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 2 },
  { id: "single-framed", label: "Single framed", minSlots: 1, maxSlots: 1, aspect: ["9:16", "16:9"], maxVideoCells: 1, preferredSlots: 1 },
] as const;

export const COLLAGE_MOTIONS = [
  { id: "ken-burns", label: "Ken Burns" }, { id: "slide-in", label: "Slide in" }, { id: "zoom-in", label: "Zoom in" },
  { id: "parallax-drift", label: "Parallax drift" }, { id: "pop-in", label: "Pop in" }, { id: "drift", label: "Drift" },
] as const;
export const COLLAGE_EFFECTS = [
  { id: "vignette", label: "Vignette" }, { id: "warm-grade", label: "Warm grade" }, { id: "film-grain", label: "Film grain" }, { id: "light-leak", label: "Light leak" },
] as const;
const motionIds = COLLAGE_MOTIONS.map((item) => item.id) as [typeof COLLAGE_MOTIONS[number]["id"], ...typeof COLLAGE_MOTIONS[number]["id"][]];
const effectIds = COLLAGE_EFFECTS.map((item) => item.id) as [typeof COLLAGE_EFFECTS[number]["id"], ...typeof COLLAGE_EFFECTS[number]["id"][]];

const slotSchema = z.strictObject({
  slotId: z.string().min(1),
  shotId: z.string().min(1).optional(),
  src: z.string().min(1).optional(),
  crop: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().positive().max(1), h: z.number().positive().max(1) }).optional(),
}).refine((slot) => Boolean(slot.shotId) !== Boolean(slot.src), "provide exactly one of shotId or src");

export const CollageSpecSchema = z.strictObject({
  layoutId: z.enum(COLLAGE_LAYOUTS.map((layout) => layout.id) as [typeof COLLAGE_LAYOUTS[number]["id"], ...typeof COLLAGE_LAYOUTS[number]["id"][]]),
  slots: z.array(slotSchema),
  motionId: z.enum(motionIds),
  effectId: z.enum(effectIds).nullable(),
  seed: z.string(),
  durationSec: z.number().finite().positive(),
}).superRefine((spec, ctx) => {
  const layout = COLLAGE_LAYOUTS.find((item) => item.id === spec.layoutId)!;
  if (spec.slots.length < layout.minSlots || spec.slots.length > layout.maxSlots) {
    ctx.addIssue({ code: "custom", path: ["slots"], message: `${layout.id} requires ${layout.minSlots}–${layout.maxSlots} slots` });
  }
  const ids = spec.slots.map((slot) => slot.slotId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["slots"], message: "slotId values must be unique" });
});

export type CollageSpec = z.infer<typeof CollageSpecSchema>;
export type CollageSlot = CollageSpec["slots"][number];

export function slotCountForLayout(layoutId: CollageSpec["layoutId"]): number {
  return COLLAGE_LAYOUTS.find((layout) => layout.id === layoutId)!.preferredSlots;
}
