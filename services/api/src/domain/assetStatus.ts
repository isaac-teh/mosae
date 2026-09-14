export type AssetStatus = "uploaded" | "ingested" | "understood" | "failed";

const NEXT: Record<AssetStatus, AssetStatus[]> = {
  uploaded: ["uploaded", "ingested", "failed"],
  ingested: ["understood", "failed"],
  understood: [],
  failed: [],
};

export function canTransition(from: AssetStatus | null, to: AssetStatus): boolean {
  if (from === null) return to === "uploaded";
  return NEXT[from].includes(to);
}
