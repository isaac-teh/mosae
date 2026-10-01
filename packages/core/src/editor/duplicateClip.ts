import type { EditOp } from "@mosae/contracts";

/** Creates the undoable edit operation that duplicates a timeline clip. */
export function duplicateClip(clipId: string): EditOp {
  return { op: "duplicate", clipId };
}
