import { ensureSignedIn, getCoreConfig } from "@mosae/core";

/** A single photo-face crop awaiting (or holding) a character identity. */
export type FaceAssignment = {
  faceId: string;
  /** Normalised [ymin, xmin, ymax, xmax] within the shot's image. */
  bbox?: [number, number, number, number];
  characterId?: string | null;
  name?: string | null;
  /** Null for an unassigned face — that is the shape the read route returns. */
  role?: "MAIN" | "SUPPORTING" | null;
};

/** Every shot in the project with its faces, grouped by shot id. */
export type CharacterShot = {
  shotId: string;
  /** The image the faces were found in — what a crop is taken from. */
  assetId: string;
  faces: FaceAssignment[];
};

export type ProjectCharacters = { shots: CharacterShot[] };

export type AssignCharacterInput = {
  faceId: string;
  name?: string | null;
  /** Omitted, never null: the backend reads a missing role as "no role". */
  role?: "MAIN" | "SUPPORTING";
};

/** Reads every photo-face in the project, grouped by shot. */
export async function getProjectCharacters(projectId: string): Promise<ProjectCharacters> {
  const user = await ensureSignedIn();
  const path = "/api/projects/" + encodeURIComponent(projectId) + "/characters";
  const res = await fetch(getCoreConfig().apiBaseUrl + path, {
    headers: { Authorization: "Bearer " + (await user.getIdToken()) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Unable to load your characters");
  return json as ProjectCharacters;
}

/** Assigns a character identity to one stored face. The backend derives `characterId` from the name. */
export async function assignCharacter(projectId: string, shotId: string, input: AssignCharacterInput): Promise<FaceAssignment> {
  const user = await ensureSignedIn();
  const path = "/api/projects/" + encodeURIComponent(projectId) + "/shots/" + encodeURIComponent(shotId) + "/characters";
  const res = await fetch(getCoreConfig().apiBaseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Unable to save this character");
  return json.face as FaceAssignment;
}

/** The signed, short-lived URL for a shot's source image, used for face crops. */
export async function getAssetThumbnailUrl(projectId: string, assetId: string): Promise<string> {
  const user = await ensureSignedIn();
  const path = "/api/projects/" + encodeURIComponent(projectId) + "/assets/" + encodeURIComponent(assetId) + "/thumbnail";
  const res = await fetch(getCoreConfig().apiBaseUrl + path, {
    headers: { Authorization: "Bearer " + (await user.getIdToken()) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Unable to load this image");
  return json.url as string;
}

/**
 * Records which characters the film should be built around. The planner resolves
 * these to shot ids and folds them into the proposal's must-include set, so this
 * revises the proposal and the caller continues with the id it returns.
 */
export async function setFocusCharacters(projectId: string, proposalId: string, focusCharacterIds: string[]): Promise<string> {
  const user = await ensureSignedIn();
  const path = "/api/projects/" + encodeURIComponent(projectId) + "/proposals/" + encodeURIComponent(proposalId) + "/constraints";
  const res = await fetch(getCoreConfig().apiBaseUrl + path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
    body: JSON.stringify({ focusCharacterIds }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Unable to save your main characters");
  return (json.proposal?.id as string) ?? proposalId;
}

export type CastRole = "parent" | "child" | "other";

/** One person in the film's cast, as the director found or the user confirmed them. */
export type CastPerson = {
  personId: string;
  role: CastRole;
  name?: string;
  excluded?: boolean;
  appearances: number;
  subjectCount: number;
  faceIds: string[];
};

export type Cast = { people: CastPerson[]; core: string[]; focus: string[]; confirmed?: boolean };

export type ConfirmCastInput = {
  people: { personId: string; role: CastRole; name?: string; excluded?: boolean }[];
  /** Empty lets the director choose the focus from who is most often the subject. */
  focus: string[];
  moves?: { faceId: string; personId: string }[];
  /** The plan on screen; the cast is applied to it and a revised version comes back. */
  proposalId?: string;
};

/** The cast the director built, or null when planning hasn't produced one yet. */
export async function getCast(projectId: string): Promise<Cast | null> {
  const user = await ensureSignedIn();
  const path = "/api/projects/" + encodeURIComponent(projectId) + "/cast";
  const res = await fetch(getCoreConfig().apiBaseUrl + path, {
    headers: { Authorization: "Bearer " + (await user.getIdToken()) },
  });
  if (res.status === 404) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Unable to load who is in your film");
  return json.cast as Cast;
}

/** Confirms the cast. With a proposalId, returns the revised plan's id to continue with. */
export async function confirmCast(projectId: string, input: ConfirmCastInput): Promise<{ cast: Cast; proposalId?: string }> {
  const user = await ensureSignedIn();
  const path = "/api/projects/" + encodeURIComponent(projectId) + "/cast";
  const res = await fetch(getCoreConfig().apiBaseUrl + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Unable to save who is in your film");
  return json as { cast: Cast; proposalId?: string };
}
