export const PIPELINE_VERSION = 1;

export type Stage = "ingest" | "understand" | "plan" | "compose" | "render" | "cluster";

/**
 * What a unit of work is about. Asset stages run per uploaded file; job stages
 * run per planning or composition request; generation stages run per film
 * version. Including the kind keeps ids from different collections apart when
 * they happen to collide.
 */
export type SubjectKind = "asset" | "job" | "generation" | "project";

export const STAGE_PATHS: Record<Stage, string> = {
  ingest: "/tasks/ingest",
  understand: "/tasks/understand",
  plan: "/tasks/plan",
  compose: "/tasks/compose",
  render: "/tasks/render",
  cluster: "/tasks/cluster",
};

export type OriginalPath = {
  userId: string;
  projectId: string;
  sessionId: string;
  assetId: string;
};

const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidId(value: string): boolean {
  return ID.test(value);
}

function assertId(value: string): string {
  if (!isValidId(value)) throw new Error("invalid id");
  return value;
}

export function buildOriginalPath(p: OriginalPath): string {
  return [
    "uploads",
    assertId(p.userId),
    assertId(p.projectId),
    assertId(p.sessionId),
    assertId(p.assetId),
    "original",
  ].join("/");
}

export function parseOriginalPath(objectName: string): OriginalPath | null {
  const parts = objectName.split("/");
  if (parts.length !== 6 || parts[0] !== "uploads" || parts[5] !== "original")
    return null;
  const [, userId, projectId, sessionId, assetId] = parts;
  if (![userId, projectId, sessionId, assetId].every(isValidId)) return null;
  return { userId, projectId, sessionId, assetId };
}

export function workKey(k: {
  projectId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  generation: string;
  stage: Stage;
  pipelineVersion: number;
}): string {
  return [
    k.projectId,
    k.subjectKind,
    k.subjectId,
    k.generation,
    k.stage,
    k.pipelineVersion,
  ].join(":");
}

export type DerivativeName = "thumb.jpg" | "render.jpg" | "proxy.mp4";

export type DerivativeOwner = {
  userId: string;
  projectId: string;
  assetId: string;
  generation: string;
};

/**
 * Derivatives live under proxies/, never under uploads/, so a derivative can
 * never match parseOriginalPath and re-trigger ingest.
 */
export function buildDerivativePath(owner: DerivativeOwner, name: DerivativeName): string {
  return [
    "proxies",
    assertId(owner.userId),
    assertId(owner.projectId),
    assertId(owner.assetId),
    assertId(owner.generation),
    name,
  ].join("/");
}
