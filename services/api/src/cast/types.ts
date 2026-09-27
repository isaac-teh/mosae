export type AgeBand = "child" | "teen" | "adult" | "senior";

export type FaceRef = {
  faceId: string;
  shotId: string;
  photoHash: string;
  bbox: [number, number, number, number];
  ageBand?: AgeBand;
  prominence?: "primary" | "secondary" | "background";
};

export type Interaction = { from: string; to: string; kind: string }; // faceIds

export interface IdentityResolver {
  readonly source: "labelled" | "embeddings";
  /** faceId → personId for the faces it can place; unplaced faces are absent. */
  resolve(faces: FaceRef[]): Map<string, string>;
}

export type CastPerson = {
  personId: string;
  ageBand: AgeBand;
  role: "parent" | "child" | "other";
  appearances: number;
  faceIds: string[];
  confidence: "high" | "low";
};

export type Cast = {
  people: CastPerson[];
  core: string[];
  focus: string[];
  source: IdentityResolver["source"] | "none";
};
