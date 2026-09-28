import { z } from "zod";
export const COLLAGE_LAYOUTS = [
 {id:"photo-table",label:"Photo table",minSlots:4,maxSlots:6,aspect:["9:16","16:9"],maxVideoCells:1,preferredSlots:6},
 {id:"travel-journal",label:"Travel journal",minSlots:3,maxSlots:4,aspect:["9:16"],maxVideoCells:1,preferredSlots:4},
 {id:"torn-paper",label:"Torn paper mosaic",minSlots:3,maxSlots:5,aspect:["9:16","16:9"],maxVideoCells:1,preferredSlots:4},
 {id:"polaroid-garland",label:"Polaroid garland",minSlots:3,maxSlots:5,aspect:["9:16"],maxVideoCells:1,preferredSlots:4},
 {id:"film-negative",label:"Film negative",minSlots:3,maxSlots:5,aspect:["9:16","16:9"],maxVideoCells:1,preferredSlots:4},
 {id:"postcard-stack",label:"Postcard stack",minSlots:3,maxSlots:5,aspect:["9:16"],maxVideoCells:1,preferredSlots:4},
 {id:"editorial-story",label:"Editorial story",minSlots:3,maxSlots:4,aspect:["9:16","16:9"],maxVideoCells:1,preferredSlots:4},
 {id:"route-map",label:"Route map",minSlots:3,maxSlots:5,aspect:["9:16"],maxVideoCells:1,preferredSlots:4},
 {id:"round-trip",label:"Round trip",minSlots:3,maxSlots:5,aspect:["9:16"],maxVideoCells:1,preferredSlots:4},
 {id:"souvenir-board",label:"Souvenir board",minSlots:3,maxSlots:5,aspect:["9:16"],maxVideoCells:1,preferredSlots:4},
 {id:"ticket-stubs",label:"Ticket stubs",minSlots:3,maxSlots:5,aspect:["9:16"],maxVideoCells:1,preferredSlots:4},
 {id:"window-arches",label:"Window arches",minSlots:3,maxSlots:4,aspect:["9:16"],maxVideoCells:1,preferredSlots:3},
] as const;
export const COLLAGE_MOTIONS=[{id:"print-drop",label:"Print drop"},{id:"stack-deal",label:"Stack deal"},{id:"overhead-settle",label:"Overhead settle"},{id:"parallax-glide",label:"Parallax glide"},{id:"page-turn",label:"Page turn"},{id:"tape-slap",label:"Tape slap"},{id:"crash-zoom",label:"Crash zoom"},{id:"focus-relay",label:"Focus relay"}] as const;
export const COLLAGE_EFFECTS=[{id:"vignette",label:"Vignette"},{id:"warm-grade",label:"Warm grade"},{id:"film-grain",label:"Film grain"},{id:"light-leak",label:"Light leak"}] as const;
const motionIds=COLLAGE_MOTIONS.map(x=>x.id) as [typeof COLLAGE_MOTIONS[number]["id"],...typeof COLLAGE_MOTIONS[number]["id"][]];
const effectIds=COLLAGE_EFFECTS.map(x=>x.id) as [typeof COLLAGE_EFFECTS[number]["id"],...typeof COLLAGE_EFFECTS[number]["id"][]];
const slotSchema=z.strictObject({slotId:z.string().min(1),shotId:z.string().min(1).optional(),src:z.string().min(1).optional(),crop:z.strictObject({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1)}).optional()}).refine(s=>Boolean(s.shotId)!==Boolean(s.src),"provide exactly one of shotId or src");
export const CollageSpecSchema=z.strictObject({layoutId:z.enum(COLLAGE_LAYOUTS.map(x=>x.id) as [typeof COLLAGE_LAYOUTS[number]["id"],...typeof COLLAGE_LAYOUTS[number]["id"][]]),slots:z.array(slotSchema),motionId:z.enum(motionIds),effectId:z.enum(effectIds).nullable(),seed:z.string(),durationSec:z.number().finite().positive(),caption:z.strictObject({place:z.string().optional(),date:z.string().optional(),headline:z.string().optional(),subline:z.string().optional()}).optional()}).superRefine((spec,ctx)=>{const layout=COLLAGE_LAYOUTS.find(x=>x.id===spec.layoutId)!;if(spec.slots.length<layout.minSlots||spec.slots.length>layout.maxSlots)ctx.addIssue({code:"custom",path:["slots"],message:`${layout.id} requires ${layout.minSlots}–${layout.maxSlots} slots`});const ids=spec.slots.map(x=>x.slotId);if(new Set(ids).size!==ids.length)ctx.addIssue({code:"custom",path:["slots"],message:"slotId values must be unique"});});
export type CollageSpec=z.infer<typeof CollageSpecSchema>;
export type CollageSlot=CollageSpec["slots"][number];
export function slotCountForLayout(id:CollageSpec["layoutId"]):number{return COLLAGE_LAYOUTS.find(x=>x.id===id)!.preferredSlots;}
