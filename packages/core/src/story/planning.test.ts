import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ post: vi.fn(), signIn: vi.fn(), snapshot: vi.fn() }));
vi.mock("../apiClient", () => ({ apiPost: boundary.post }));
vi.mock("../auth", () => ({ ensureSignedIn: boundary.signIn }));
vi.mock("../firebase", () => ({ getFirestoreClient: () => "db" }));
vi.mock("firebase/firestore", () => ({ doc: (_db: unknown, ...parts: string[]) => parts.join("/"), onSnapshot: boundary.snapshot }));
import * as planning from "./planning";

beforeEach(() => { vi.resetAllMocks(); boundary.signIn.mockResolvedValue({}); });
describe("live story planning", () => {
  it("posts the intent and focus to the explicit project and retains the queued job identity", async () => {
    boundary.post.mockResolvedValue({ job: { id: "job-1", proposalId: "proposal-1", status: "waiting_for_ready", version: 1 } });
    expect(await planning.startStoryPlan("project-actual", "Our trip", ["Family"])).toEqual({ id: "job-1", proposalId: "proposal-1", status: "waiting_for_ready", version: 1 });
    expect(boundary.post).toHaveBeenCalledWith("/api/projects/project-actual/story-intents", { text: "Our trip", focus: ["Family"] });
  });
  it("streams progress and the terminal failure reason from the authenticated job path", async () => {
    const onChange = vi.fn();
    const unsubscribe = vi.fn();
    boundary.snapshot.mockReturnValue(unsubscribe);
    const stop = planning.watchStoryPlan("actual", "job-1", { onChange, onError: vi.fn() });
    await Promise.resolve();
    expect(boundary.snapshot.mock.calls[0][0]).toBe("projects/actual/jobs/job-1");
    const update = boundary.snapshot.mock.calls[0][1];
    for (const progress of ["searching", "inspecting", "organizing"]) {
      update({ exists: () => true, data: () => ({ id: "job-1", proposalId: "p", status: "running", progress }) });
    }
    update({ exists: () => true, data: () => ({ id: "job-1", proposalId: "p", status: "failed", reason: "No matching memories" }) });
    expect(onChange.mock.calls.map(([job]) => job.progress ?? job.reason)).toEqual(["searching", "inspecting", "organizing", "No matching memories"]);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("does not attach a listener if unmounted before authentication finishes", async () => {
    let resolve!: (value: unknown) => void;
    boundary.signIn.mockImplementation(() => new Promise(done => { resolve = done; }));
    const stop = planning.watchStoryPlan("p", "j", { onChange: vi.fn(), onError: vi.fn() });
    stop(); resolve({}); await Promise.resolve();
    expect(boundary.snapshot).not.toHaveBeenCalled();
  });
  it("reports an unreadable job and authentication failures instead of waiting forever", async () => {
    const onError = vi.fn();
    const onChange = vi.fn();
    boundary.snapshot.mockReturnValue(vi.fn());
    planning.watchStoryPlan("p", "j", { onChange, onError });
    await Promise.resolve();
    boundary.snapshot.mock.calls[0][1]({ exists: () => false });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Planning job is unavailable. Please reconnect." }));
    boundary.signIn.mockRejectedValue(new Error("Sign in failed"));
    planning.watchStoryPlan("p", "j", { onChange, onError });
    await Promise.resolve(); await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Sign in failed" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
