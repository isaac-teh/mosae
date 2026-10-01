export type FaceCropInput = {
  bbox: [number, number, number, number];
  prominence?: string;
  faceVisible?: boolean;
};
export type CropSize = { width: number; height: number };
export type CropRect = { left: number; top: number; width: number; height: number };

/** Return a padded pixel rectangle for a usable normalized face box. */
export function faceCropRect(face: FaceCropInput, size: CropSize): CropRect | null {
  if (face.prominence === "background" || face.faceVisible === false) return null;
  if (!(size.width > 0 && size.height > 0)) return null;
  const [ymin, xmin, ymax, xmax] = face.bbox;
  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return null;
  if (xmin < 0 || ymin < 0 || xmax > 1 || ymax > 1 || xmax <= xmin || ymax <= ymin) return null;

  const boxWidth = xmax - xmin;
  const boxHeight = ymax - ymin;
  if (boxWidth * size.width < 48 || boxHeight * size.height < 48) return null;
  if (boxHeight > boxWidth * 1.6 || boxWidth * boxHeight > 0.35) return null;

  const left = Math.max(0, Math.floor((xmin - boxWidth * 0.1) * size.width + 1e-9));
  const top = Math.max(0, Math.floor((ymin - boxHeight * 0.1) * size.height + 1e-9));
  const right = Math.min(size.width, Math.ceil((xmax + boxWidth * 0.1) * size.width - 1e-9));
  const bottom = Math.min(size.height, Math.ceil((ymax + boxHeight * 0.1) * size.height - 1e-9));
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}
