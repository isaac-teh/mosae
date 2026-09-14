export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;

export type EntryOutcome = "pending" | "finalized" | "cancelled" | "failed";

export type ManifestEntry = {
  assetId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  outcome: EntryOutcome;
  generation: string | null;
  failureReason: string | null;
};

export type UploadSession = { id: string; projectId: string; userId: string; closed: boolean; createdAt: number };

export type EntryEvent =
  | { kind: "finalized"; generation: string }
  | { kind: "cancelled" }
  | { kind: "failed"; reason: string };

export function validateNewEntry(input: { fileName: string; contentType: string; sizeBytes: number }): string | null {
  if (!/^(image|video)\//.test(input.contentType)) return "unsupported_type";
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) return "invalid_size";
  if (input.sizeBytes > MAX_UPLOAD_BYTES) return "too_large";
  return null;
}

export function canAddEntries(session: UploadSession): boolean {
  return !session.closed;
}

export function sessionSettled(session: UploadSession, entries: ManifestEntry[]): boolean {
  return session.closed && entries.every((e) => e.outcome !== "pending");
}

export function applyEntryEvent(entry: ManifestEntry, event: EntryEvent): { entry: ManifestEntry; changed: boolean } {
  const unchanged = { entry, changed: false };
  if (entry.outcome === "cancelled" || entry.outcome === "failed") return unchanged;

  if (event.kind === "finalized") {
    if (entry.outcome === "finalized" && BigInt(event.generation) <= BigInt(entry.generation ?? "0")) return unchanged;
    return { entry: { ...entry, outcome: "finalized", generation: event.generation }, changed: true };
  }
  if (entry.outcome === "finalized") return unchanged;
  if (event.kind === "cancelled") return { entry: { ...entry, outcome: "cancelled" }, changed: true };
  return { entry: { ...entry, outcome: "failed", failureReason: event.reason }, changed: true };
}
