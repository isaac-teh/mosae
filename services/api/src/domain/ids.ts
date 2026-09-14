export const PIPELINE_VERSION = 1;

export type Stage = "ingest" | "understand";

export type OriginalPath = { userId: string; projectId: string; sessionId: string; assetId: string };

const ID = /^[A-Za-z0-9_-]{1,128}$/;

function assertId(value: string): string {
  if (!ID.test(value)) throw new Error("invalid id");
  return value;
}

export function buildOriginalPath(p: OriginalPath): string {
  return ["uploads", assertId(p.userId), assertId(p.projectId), assertId(p.sessionId), assertId(p.assetId), "original"].join("/");
}

export function parseOriginalPath(objectName: string): OriginalPath | null {
  const parts = objectName.split("/");
  if (parts.length !== 6 || parts[0] !== "uploads" || parts[5] !== "original") return null;
  const [, userId, projectId, sessionId, assetId] = parts;
  if (![userId, projectId, sessionId, assetId].every((v) => ID.test(v))) return null;
  return { userId, projectId, sessionId, assetId };
}

export function workKey(k: {
  projectId: string;
  assetId: string;
  generation: string;
  stage: Stage;
  pipelineVersion: number;
}): string {
  return [k.projectId, k.assetId, k.generation, k.stage, k.pipelineVersion].join(":");
}
