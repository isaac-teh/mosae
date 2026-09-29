import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MediaFacts, QualityFacts } from "../domain/media.js";
import type { PhotoAnalysis } from "../domain/understanding.js";
import type { Place } from "../understand/place.js";
import type { Cast } from "../cast/types.js";

export type DemoPhoto = {
  fileName: string;
  sourceAssetId: string;
  sourceShotId: string;
  sourceGeneration: string;
  media: MediaFacts;
  place: Place | null;
  quality: QualityFacts | null;
  analysis: PhotoAnalysis;
  eventId: string | null;
  dupOf: string | null;
};

export type DemoBundle = { version: 1; source: "trip1-v2"; photos: DemoPhoto[]; cast: Cast };

export function loadDemoBundle(): DemoBundle {
  const path = fileURLToPath(new URL("../../fixtures/demo/trip1-v2/bundle.json", import.meta.url));
  const bundle = JSON.parse(readFileSync(path, "utf8")) as DemoBundle;
  if (bundle.version !== 1 || bundle.source !== "trip1-v2" || bundle.photos.length !== 15) throw new Error("invalid_demo_bundle");
  return bundle;
}
