import { Share } from "react-native";

export type PreparedFilmDownload = { file: File; filename: string };

export async function prepareFilmDownload(url: string, title: string): Promise<PreparedFilmDownload> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("download_failed");
  const filename = (title.trim() || "film").replace(/[\\/:*?"<>|]/g, "").trim() || "film";
  const blob = await response.blob();
  return { file: new File([blob], `${filename}.mp4`, { type: "video/mp4" }), filename };
}

function downloadWithAnchor(file: File, filename: string): void {
  if (typeof document === "undefined") throw new Error("download_unavailable");
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `${filename}.mp4`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

export async function downloadFilm(
  url: string,
  title: string,
  onPreparing?: (preparing: boolean) => void,
  prepared?: PreparedFilmDownload | null,
): Promise<void> {
  onPreparing?.(true);
  try {
    const download = prepared ?? await prepareFilmDownload(url, title);
    if (typeof document === "undefined") {
      await Share.share({ message: url });
      return;
    }
    let canShareFiles = false;
    try { canShareFiles = Boolean(navigator.canShare?.({ files: [download.file] }) && navigator.share); }
    catch { canShareFiles = false; }
    if (canShareFiles) {
      try {
        await navigator.share({ files: [download.file] });
        return;
      } catch (error) {
        if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
      }
    }
    downloadWithAnchor(download.file, download.filename);
  } finally {
    onPreparing?.(false);
  }
}
