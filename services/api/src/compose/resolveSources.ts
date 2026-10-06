import { collageShotIds, type Timeline, type AudioClip } from "@mosae/contracts";

/** How sources should be resolved — proxy URLs for preview, originals for render. */
export type ResolveMode = "preview" | "render";

/** Dependencies needed to resolve a timeline's source IDs to file paths. */
export interface SourceDeps {
  /** Load an asset by projectId and assetId. Returns null if not found. */
  loadAsset: (projectId: string, assetId: string) => Promise<{ storagePath: string; width?: number; height?: number; derivatives?: { proxyPath?: string | null; renderPath?: string | null; thumbPath: string } } | null>;
  /**
   * Resolve a soundtrack id to a file. The soundtrack library does not exist
   * yet, so this is normally absent and a scored film simply resolves no music
   * source — which the render service accepts, because the spec says a film
   * with no resolvable score is still a valid film. When it *is* supplied, a
   * soundtrack it cannot resolve is an error, not a silent omission: a
   * configured library that does not have the track is a broken film.
   */
  loadSoundtrack?: (soundtrackId: string) => Promise<string | null>;
}

/** Adds ingest-normalized dimensions to direct clip sources. The resolver takes a shotId (not an assetId). */
export async function addSourceDimensions(
  timeline: Timeline,
  loadShot: (projectId: string, shotId: string) => Promise<{ width?: number; height?: number } | null>,
  projectId: string,
): Promise<Timeline> {
  const videoClips = await Promise.all((timeline.videoClips ?? []).map(async (clip) => {
    if (!("source" in clip)) return clip;
    const asset = await loadShot(projectId, clip.source.shotId);
    if (!asset?.width || !asset.height) return clip;
    return { ...clip, source: { ...clip.source, width: asset.width, height: asset.height } };
  }));
  return { ...timeline, videoClips };
}

/**
 * Resolve every ID a Timeline names to an actual file path.
 *
 * - shotId → the asset's proxy (preview) or original storage path (render)
 * - assetId → same resolution for audio clips referencing assets
 * - soundtrackId → through `deps.loadSoundtrack`, when a library exists
 *
 * One function serves both preview and render modes so they can never disagree
 * about which IDs matter. The caller chooses the mode to pick proxy vs original paths.
 */
export async function resolveSources(
  timeline: Timeline,
  deps: SourceDeps,
  projectId: string,
  mode: ResolveMode = "preview",
): Promise<Record<string, string>> {
  const sources: Record<string, string> = {};

  // Collect all unique IDs that need resolution
  const neededKinds = new Map<string, "photo" | "video" | "audio">();
  const soundtrackIds = new Set<string>();

  for (const clip of timeline.videoClips) {
    if ("source" in clip) neededKinds.set(clip.source.shotId, clip.source.kind);
  }
  for (const shotId of collageShotIds(timeline)) neededKinds.set(shotId, "photo");

  for (const audio of timeline.audioClips) {
    if (audio.source.kind === "asset") {
      neededKinds.set(audio.source.assetId, "audio");
    } else {
      soundtrackIds.add(audio.source.soundtrackId);
    }
  }

  // A soundtrack resolves through its own library, when there is one.
  for (const soundtrackId of soundtrackIds) {
    if (!deps.loadSoundtrack) continue;
    const path = await deps.loadSoundtrack(soundtrackId);
    if (!path) throw new Error(`missing soundtrack: ${soundtrackId}`);
    sources[soundtrackId] = path;
  }

  // Resolve each ID to a file path
  for (const [id, kind] of neededKinds) {
    const asset = await deps.loadAsset(projectId, id);
    if (!asset) {
      throw new Error(`missing source: ${id}`);
    }

    if (mode === "preview") {
      // Photo and collage frames are rendered as images, so an MP4 proxy
      // cannot serve them. Video clips need the playable proxy instead.
      sources[id] = kind === "video"
        ? asset.derivatives?.proxyPath || asset.derivatives?.thumbPath || asset.storagePath
        : kind === "photo"
          ? asset.derivatives?.thumbPath || asset.storagePath
          : asset.storagePath;
    } else {
      // Photo originals may be HEIC, CMYK, or far larger than the renderer
      // needs. Ingest normalizes them to a bounded JPEG render derivative.
      // Videos still render from their original container.
      sources[id] = kind === "photo"
        ? asset.derivatives?.renderPath || asset.storagePath
        : asset.storagePath;
    }
  }

  return sources;
}

/**
 * Get the set of all source IDs a Timeline needs, without resolving paths.
 * Useful for validation before calling resolveSources.
 */
export function collectSourceIds(timeline: Timeline): Set<string> {
  const ids = new Set<string>();

  for (const clip of timeline.videoClips) {
    if ("source" in clip) ids.add(clip.source.shotId);
  }
  for (const shotId of collageShotIds(timeline)) ids.add(shotId);

  for (const audio of timeline.audioClips) {
    if (audio.source.kind === "asset") {
      ids.add(audio.source.assetId);
    }
  }

  return ids;
}
