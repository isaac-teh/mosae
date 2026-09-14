import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSet = vi.fn();
const mockGet = vi.fn();
const mockDoc = vi.fn(() => ({ set: mockSet, get: mockGet, id: "plan-123" }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));

vi.mock("../firebase/admin.js", () => ({
  adminDb: { collection: mockCollection },
}));

const { saveCurationPlan, getCurationPlan } = await import("./curationPlan.js");

describe("curationPlan", () => {
  beforeEach(() => {
    mockSet.mockReset();
    mockGet.mockReset();
    mockDoc.mockClear();
    mockCollection.mockClear();
  });

  it("saves a curation plan and returns its id", async () => {
    mockSet.mockResolvedValue(undefined);

    const id = await saveCurationPlan({
      userId: "user-1",
      storyText: "our trip to the mountains",
      selectedMediaRefs: ["gs://bucket/a.jpg", "gs://bucket/b.jpg"],
      pacing: "slow-build",
      template: "warm-nostalgic",
      createdAt: 1700000000000,
    });

    expect(mockCollection).toHaveBeenCalledWith("curationPlans");
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", storyText: "our trip to the mountains" })
    );
    expect(id).toBe("plan-123");
  });

  it("returns null when the plan does not exist", async () => {
    mockGet.mockResolvedValue({ exists: false });

    const plan = await getCurationPlan("missing-id");

    expect(plan).toBeNull();
  });

  it("returns the plan data with id when it exists", async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        userId: "user-1",
        storyText: "our trip",
        selectedMediaRefs: [],
        pacing: "slow-build",
        template: "warm-nostalgic",
        createdAt: 1700000000000,
      }),
    });

    const plan = await getCurationPlan("plan-123");

    expect(plan).toEqual({
      id: "plan-123",
      userId: "user-1",
      storyText: "our trip",
      selectedMediaRefs: [],
      pacing: "slow-build",
      template: "warm-nostalgic",
      createdAt: 1700000000000,
    });
  });
});
