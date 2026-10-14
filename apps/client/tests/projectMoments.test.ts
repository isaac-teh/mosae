import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ getCast: vi.fn(), confirmCast: vi.fn(), mutateProjectFlow: vi.fn() }));
vi.mock("@/lib/characters", () => ({ getCast: boundary.getCast, confirmCast: boundary.confirmCast, mutateProjectFlow: boundary.mutateProjectFlow }));
vi.mock("@mosae/core", () => ({ ensureSignedIn: vi.fn(async () => ({ getIdToken: async () => "token" })), getCoreConfig: () => ({ apiBaseUrl: "https://api.test" }) }));

import { savePersonMoments } from "../lib/projectMoments";

describe("savePersonMoments", () => {
  beforeEach(() => {
    boundary.getCast.mockReset().mockResolvedValue({ people: [], focus: [], source: "none" });
    boundary.confirmCast.mockReset().mockResolvedValue({});
    boundary.mutateProjectFlow.mockReset().mockResolvedValue({});
  });

  it("saves tags for an unnamed person without persisting the display placeholder as a name", async () => {
    await savePersonMoments("project-1", "person-1", null, ["shot-1"], []);
    expect(boundary.confirmCast).toHaveBeenCalledWith("project-1", {
      people: [{ personId: "person-1", role: "other", excluded: false, addShots: ["shot-1"], removeShots: [] }],
      focus: [],
    });
    expect(boundary.mutateProjectFlow).toHaveBeenCalledWith("project-1", {
      type: "person", personId: "person-1", name: null, role: "other", confirmed: false, skipped: false,
    });
  });

  it("drops duplicate cast rows and absorbed identities from gallery focus saves", async () => {
    boundary.getCast.mockResolvedValue({ people: [
      { personId: "chloe", role: "child", faceIds: [], excluded: false },
      { personId: "chloe", role: "child", faceIds: [], excluded: false },
      { personId: "kara", role: "child", faceIds: [], excluded: false },
    ], focus: ["chloe", "absorbed-kara", "chloe"], source: "embeddings" });
    await savePersonMoments("project-1", "chloe", "Chloe", ["shot-4"], []);
    expect(boundary.confirmCast).toHaveBeenCalledWith("project-1", {
      people: [
        { personId: "chloe", role: "child", name: "Chloe", excluded: false, addShots: ["shot-4"], removeShots: [] },
        { personId: "kara", role: "child", name: undefined, excluded: false },
      ],
      focus: ["chloe"],
    });
  });

  it("resolves a stale merged gallery id to the unique live cast person with the same name", async () => {
    boundary.getCast.mockResolvedValue({ people: [
      { personId: "chloe-current", name: "Chloe", role: "child", faceIds: [], excluded: false },
      { personId: "kara", name: "Kara", role: "child", faceIds: [], excluded: false },
    ], focus: ["chloe-current", "absorbed-chloe"], source: "embeddings" });
    await expect(savePersonMoments("project-1", "absorbed-chloe", "Chloe", ["shot-5"], [])).resolves.toBe("chloe-current");
    expect(boundary.confirmCast).toHaveBeenCalledWith("project-1", expect.objectContaining({
      people: expect.arrayContaining([expect.objectContaining({ personId: "chloe-current", addShots: ["shot-5"] })]),
      focus: ["chloe-current"],
    }));
    expect(boundary.mutateProjectFlow).toHaveBeenCalledWith("project-1", expect.objectContaining({ type: "person", personId: "chloe-current" }));
    expect(boundary.mutateProjectFlow).toHaveBeenCalledWith("project-1", expect.objectContaining({ type: "manual-shot", personId: "chloe-current", shotId: "shot-5" }));
  });
  it("preserves a missed person ID even when the cast contains a same-name person", async () => {
    boundary.getCast.mockResolvedValue({ people: [
      { personId: "existing", name: "Chloe", role: "child", faceIds: [], excluded: false },
    ], focus: ["existing"], source: "embeddings" });
    await expect(savePersonMoments("project-1", "p-missed-chloe", "Chloe", ["shot-6"], [], [], "missed")).resolves.toBe("p-missed-chloe");
    expect(boundary.confirmCast).toHaveBeenCalledWith("project-1", expect.objectContaining({
      people: expect.arrayContaining([expect.objectContaining({ personId: "p-missed-chloe", addShots: ["shot-6"] })]),
    }));
    expect(boundary.mutateProjectFlow).toHaveBeenCalledWith("project-1", expect.objectContaining({ type: "person", personId: "p-missed-chloe" }));
  });
});
