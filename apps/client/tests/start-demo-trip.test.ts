import { describe, expect, it, vi } from "vitest";
vi.mock("@mosae/core", () => ({ apiPost: vi.fn(async () => ({ project: { id: "fresh-demo-id" } })) }));
import { apiPost } from "@mosae/core";
import { startDemoTrip } from "../lib/startDemoTrip";

describe("startDemoTrip", () => {
  it("creates a server project and enters live chat", async () => {
    const push = vi.fn();
    await startDemoTrip({ push });
    expect(apiPost).toHaveBeenCalledWith("/api/projects/demo");
    expect(push).toHaveBeenCalledWith({ pathname: "/director", params: { projectId: "fresh-demo-id", repository: "api", live: "1" } });
  });
});
