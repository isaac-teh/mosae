import type { Timeline, VideoClip, AudioClip } from "@mosae/contracts";

/** How sources should be resolved — proxy URLs for preview, originals for render. */
export type ResolveMode = "preview" | "render";

/** Dependencies needed to resolve a timeline's source IDs to file paths. */
export interface SourceDeps {
  /** Load an asset by projectId and assetId. Returns null if not found. */
  loadAsset: (projectId: string, assetId: string) => Promise<{ storagePath: string; derivatives?: { proxyPath?: string | null; renderPath?: string | null; thumbPath: string } } | null>;
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
  const neededIds = new Set<string>();
  const soundtrackIds = new Set<string>();

  for (const clip of timeline.videoClips) {
    neededIds.add(clip.source.shotId);
  }

  for (const audio of timeline.audioClips) {
    if (audio.source.kind === "asset") {
      neededIds.add(audio.source.assetId);
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
  for (const id of neededIds) {
    const asset = await deps.loadAsset(projectId, id);
    if (!asset) {
      throw new Error(`missing source: ${id}`);
    }

    if (mode === "preview") {
      // Preview mode: use proxy path or thumb as fallback
      sources[id] = asset.derivatives?.proxyPath || asset.derivatives?.thumbPath || asset.storagePath;
    } else {
      // Render mode: use original storage path
      sources[id] = asset.storagePath;
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
    ids.add(clip.source.shotId);
  }

  for (const audio of timeline.audioClips) {
    if (audio.source.kind === "asset") {
      ids.add(audio.source.assetId);
    }
  }

  return ids;
}
