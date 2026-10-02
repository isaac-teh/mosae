export type AgeBand = "child" | "teen" | "adult" | "senior";

export type FaceRef = {
  faceId: string;
  shotId: string;
  photoHash: string;
  bbox: [number, number, number, number];
  ageBand?: AgeBand;
  prominence?: "primary" | "secondary" | "background";
  vector?: number[];
  characterId?: string;
};

export type Interaction = { from: string; to: string; kind: string }; // faceIds

export interface IdentityResolver {
  readonly source: "labelled" | "embeddings";
  /** faceId → personId for the faces it can place; unplaced faces are absent. */
  resolve(faces: FaceRef[]): Map<string, string>;
  /**
   * Faces known NOT to be anyone in the family. An unplaced face is only
   * unknown; just these may take a photo out of the film.
   */
  strangers?(faces: FaceRef[]): Set<string>;
}

export type CastPerson = {
  personId: string;
  subjectCount: number;
  name?: string;
  excluded?: boolean;
  ageBand: AgeBand;
  role: "parent" | "child" | "other";
  appearances: number;
  faceIds: string[];
  confidence: "high" | "low";
  similarPersonId?: string;
  similarity?: number;
};

export type Cast = {
  people: CastPerson[];
  core: string[];
  focus: string[];
  source: IdentityResolver["source"] | "none";
  confirmed?: boolean;
};
