export function isMedia(file: File): boolean {
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function mediaId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}
