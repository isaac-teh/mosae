import { StableUriImage } from "./StableUriImage";

const previewUrls = new WeakMap<File, string>();

function previewUrl(file: File) {
  let url = previewUrls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    previewUrls.set(file, url);
  }
  return url;
}

type Props = {
  file: File;
  isVideo: boolean;
  onDuration: (seconds: number) => void;
};

// Object URLs live for the tab session; revoking on unmount breaks previews under React StrictMode's double mount.
export function MediaThumb({ file, isVideo, onDuration }: Props) {
  const url = previewUrl(file);
  const style = {
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
    display: "flex",
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
    <StableUriImage uri={url} accessibilityLabel={file.name} style={style} />
  );
}
