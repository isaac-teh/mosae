import { Share } from "react-native";

export async function downloadFilm(url: string, title: string, onPreparing?: (preparing: boolean) => void): Promise<void> {
  onPreparing?.(true);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("download_failed");
    const blob = await response.blob();
    const filename = (title.trim() || "film").replace(/[\\/:*?"<>|]/g, "").trim() || "film";

    if (typeof document === "undefined") {
      await Share.share({ message: url });
      return;
    }

    const file = new File([blob], `${filename}.mp4`, { type: "video/mp4" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }

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
  } finally {
    onPreparing?.(false);
  }
}
