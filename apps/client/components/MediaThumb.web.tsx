import { useState } from "react";

type Props = {
  file: File;
  isVideo: boolean;
  onDuration: (seconds: number) => void;
};

// Object URLs live for the tab session; revoking on unmount breaks previews under React StrictMode's double mount.
export function MediaThumb({ file, isVideo, onDuration }: Props) {
  const [url] = useState(() => URL.createObjectURL(file));
  const style = {
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
    display: "block",
  };
  return isVideo ? (
    <video
      src={url}
      muted
      playsInline
      preload="metadata"
      onLoadedMetadata={(e) => onDuration(e.currentTarget.duration)}
      style={style}
    />
  ) : (
    <img src={url} alt={file.name} style={style} />
  );
}
