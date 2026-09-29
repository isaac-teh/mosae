export type FaceBbox = [number, number, number, number];

/** Face boxes are stored as [ymin, xmin, ymax, xmax] in normalized 0–1 space. */
export function normalizeFaceBbox(bbox: FaceBbox): FaceBbox {
  const scale = bbox.some((value) => Math.abs(value) > 1.05) ? 1000 : 1;
  return bbox.map((value) => Math.max(0, Math.min(1, value / scale))) as FaceBbox;
}

export type FaceCropGeometry = { width: number; height: number; left: number; top: number };

export function imageSizeFromLoadEvent(event: unknown): { width: number; height: number } | null {
  const value = event as {
    nativeEvent?: { source?: { width?: number; height?: number }; target?: { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number } };
    currentTarget?: { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
    target?: { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  } | null;
  const source = value?.nativeEvent?.source;
  const target = value?.currentTarget ?? value?.target ?? value?.nativeEvent?.target;
  const width = source?.width ?? target?.naturalWidth ?? target?.width;
  const height = source?.height ?? target?.naturalHeight ?? target?.height;
  return typeof width === "number" && width > 0 && typeof height === "number" && height > 0 ? { width, height } : null;
}

/**
 * Position the upright source image behind a square window. The crop has about
 * 30% padding on each side of the face box and is calculated in source pixels,
 * so portrait and landscape thumbnails keep their natural aspect ratio.
 */
export function faceCropGeometry(bbox: FaceBbox, sourceWidth: number, sourceHeight: number, size: number): FaceCropGeometry {
  const [ymin, xmin, ymax, xmax] = normalizeFaceBbox(bbox);
  const width = Math.max(1, sourceWidth);
  const height = Math.max(1, sourceHeight);
  const centerX = ((xmin + xmax) / 2) * width;
  const centerY = ((ymin + ymax) / 2) * height;
  const faceWidth = Math.max((xmax - xmin) * width, 1);
  const faceHeight = Math.max((ymax - ymin) * height, 1);
  // 1.6 gives 30% of the face-box dimension on all four sides.
  const cropSide = Math.min(Math.max(faceWidth, faceHeight) * 1.6, width, height);
  const half = cropSide / 2;
  const cx = width >= cropSide ? Math.max(half, Math.min(width - half, centerX)) : width / 2;
  const cy = height >= cropSide ? Math.max(half, Math.min(height - half, centerY)) : height / 2;
  const scale = size / cropSide;
  return { width: width * scale, height: height * scale, left: size / 2 - cx * scale, top: size / 2 - cy * scale };
}
