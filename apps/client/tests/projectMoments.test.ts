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
      type: "person", personId: "person-1", name: null, role: "other", confirmed: true, skipped: false,
    });
  });
});
