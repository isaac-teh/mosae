import { describe, expect, it } from "vitest";
import { FACE_RECONCILE_THRESHOLD } from "../config.js";
import { reconcileConfirmedFaces } from "./reconcileConfirmedFaces.js";

const face = (faceId: string, shotId: string, vector: number[], characterId?: string) => ({ faceId, shotId, vector, ...(characterId ? { characterId } : {}) });

describe("reconcileConfirmedFaces", () => {
  it("uses the strict, named threshold selected from the Gemini face-crop measurements", () => {
    expect(FACE_RECONCILE_THRESHOLD).toBe(0.9);
  });

  it("reassigns only close individual faces to the confirmed person", () => {
    const faces = [
      face("kara-1", "shot-1", [1, 0], "kara"),
      face("kara-2", "shot-2", [0.99, 0.1], "kara"),
      face("split-kara", "shot-3", [0.995, 0.05], "pending"),
      face("chloe", "shot-4", [0, 1], "pending"),
    ];
    expect(reconcileConfirmedFaces(faces, "kara")).toEqual(new Map([["split-kara", "kara"]]));
  });

  it("never reassigns a face from a photo containing one of the confirmed person's faces", () => {
    const faces = [
      face("kara", "shared", [1, 0], "kara"),
      face("chloe", "shared", [1, 0], "pending"),
      face("kara-2", "other", [1, 0], "kara"),
      face("kara-split", "third", [1, 0], "pending"),
    ];
    expect(reconcileConfirmedFaces(faces, "kara", 0.9)).toEqual(new Map([["kara-split", "kara"]]));
  });

  it("keeps a four-face photo per face, so only matching faces move", () => {
    const faces = [
      face("kara", "a", [1, 0], "kara"), face("kara-2", "b", [1, 0], "kara"),
      face("kara-split", "c", [1, 0], "pending"), face("chloe", "c", [0, 1], "pending"),
      face("mum", "c", [0, 1], "other"), face("dad", "c", [-1, 0], "other"),
    ];
    expect(reconcileConfirmedFaces(faces, "kara", 0.9)).toEqual(new Map([["kara-split", "kara"]]));
  });
});
