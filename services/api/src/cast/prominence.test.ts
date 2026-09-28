import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { faceProminence, photoRoles, type BBox } from "./prominence.js";

describe("faceProminence", () => {
  it("a large centred face is a subject", () => {
    const box: BBox = [0.2, 0.3, 0.7, 0.7];
    expect(faceProminence(box, [box]).role).toBe("subject");
  });
  it("a tiny face at the edge next to a big one is background", () => {
    const big: BBox = [0.2, 0.3, 0.7, 0.7];
    const small: BBox = [0.05, 0.9, 0.12, 0.97];
    expect(photoRoles([big, small])).toEqual(["subject", "background"]);
  });
  it("a tiny distant face alone in a scenery photo is not promoted to subject", () => {
    expect(photoRoles([[0.45, 0.48, 0.47, 0.5]])).toEqual(["background"]);
  });
  it("the largest face is a subject even below the threshold when it clears the floor", () => {
    const roles = photoRoles([[0.3, 0.4, 0.45, 0.52], [0.1, 0.85, 0.16, 0.9]]);
    expect(roles[0]).toBe("subject");
  });
  it("whole-body boxes still count by size and position", () => {
    expect(photoRoles([[0.1, 0.35, 0.95, 0.6]])).toEqual(["subject"]);
  });
});

describe("ground truth (trip1-v2)", () => {
  async function loadLabels() {
    return JSON.parse(await readFile(new URL("../../fixtures/cast/trip1-v2.json", import.meta.url), "utf8")) as {
      photos: Record<string, { bbox: BBox; personId?: string; expect?: string }[]>;
    };
  }
  it("agrees with at least 90% of hand labels", async () => {
    const labels = await loadLabels();
    let total = 0, right = 0;
    for (const faces of Object.values(labels.photos)) {
      const roles = photoRoles(faces.map((f) => f.bbox));
      faces.forEach((f, i) => { if (!f.expect) return; total++; if (roles[i] === f.expect) right++; });
    }
    expect(total).toBeGreaterThan(20);
    expect(right / total).toBeGreaterThanOrEqual(0.9);
  });
  it("keeps the pasted photobomb face in the background", async () => {
    const labels = await loadLabels(), target = [0.06004464285714286, 0.7032738095238096, 0.19017857142857142, 0.7632440476190476];
    const faces = Object.values(labels.photos).find((fs) => fs.some((f) => !f.personId && f.bbox.join(",") === target.join(",")));
    expect(faces).toBeDefined();
    const i = faces!.findIndex((f) => !f.personId && f.bbox.join(",") === target.join(","));
    expect(photoRoles(faces!.map((f) => f.bbox))[i]).toBe("background");
  });
  it("keeps the distant landscape face in the background", async () => {
    const labels = await loadLabels(), target = [0.29608938547486036, 0.2398936170212766, 0.3136472466081405, 0.24840425531914895];
    const faces = Object.values(labels.photos).find((fs) => fs.some((f) => !f.personId && f.bbox.join(",") === target.join(",")));
    expect(faces).toBeDefined();
    const i = faces!.findIndex((f) => !f.personId && f.bbox.join(",") === target.join(","));
    expect(photoRoles(faces!.map((f) => f.bbox))[i]).toBe("background");
  });
});
