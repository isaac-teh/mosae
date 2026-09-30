import { z } from "zod";

export const RenderResolutionSchema = z.enum(["720p", "1080p"]).default("720p");
export type RenderResolution = z.infer<typeof RenderResolutionSchema>;
