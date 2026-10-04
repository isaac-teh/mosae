export type FullscreenMode = "native" | "webkit" | "overlay";

type FullscreenElement = { requestFullscreen?: () => Promise<void> | void };
type WebkitVideo = { webkitEnterFullscreen?: () => void };

export function fullscreenMode(element: FullscreenElement | null, video: WebkitVideo | null): FullscreenMode {
  if (element?.requestFullscreen) return "native";
  if (video?.webkitEnterFullscreen) return "webkit";
  return "overlay";
}

export function seekTimeAtPosition(clientX: number, left: number, width: number, durationSec: number): number {
  if (width <= 0 || durationSec <= 0) return 0;
  const fraction = Math.max(0, Math.min(1, (clientX - left) / width));
  return fraction * durationSec;
}

export function formatFilmTime(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(safeSeconds / 60).toString().padStart(2, "0")}:${Math.floor(safeSeconds % 60).toString().padStart(2, "0")}`;
}
