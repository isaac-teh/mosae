import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeProgress } from "../../../packages/core/src/progress/progress";

const boundary = vi.hoisted(() => ({
  params: {} as any, progress: null as any, push: vi.fn(), start: vi.fn(), watch: vi.fn(),
  fixtureCreate: vi.fn(), setRepository: vi.fn(), apiRepository: vi.fn(),
}));
vi.mock("@mosae/core", () => ({
  getStoryRepository: () => ({ createPlan: boundary.fixtureCreate }),
  createFixtureStoryRepository: () => ({ createPlan: boundary.fixtureCreate }),
  startStoryPlan: boundary.start, watchStoryPlan: boundary.watch,
  setStoryRepository: boundary.setRepository, createApiStoryRepository: boundary.apiRepository,
  describeProgress: (progress: any) => describeProgress(progress),
}));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => boundary.params, useRouter: () => ({ push: boundary.push }) }));
vi.mock("@/lib/useStepBack", () => ({ useStepBack: () => vi.fn() }));
vi.mock("@/lib/useDictation", () => ({ useDictation: () => ({ supported: false, listening: false }) }));
vi.mock("@/lib/useProjectProgress", () => ({ useProjectProgress: () => boundary.progress }));
vi.mock("@/components/StepHeader", () => ({ StepHeader: () => null }));
vi.mock("@/components/icons", () => ({ ChipCheckIcon: () => null, MicIcon: () => null, ShieldIcon: () => null, SparklesIcon: () => null }));
vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, onChangeText, multiline, textAlignVertical, stickyHeaderIndices, keyboardShouldPersistTaps, placeholderTextColor, ...props }: any) =>
    React.createElement(tag, { ...props, onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined }, children);
  return { View: element("div"), ScrollView: element("div"), Text: element("span"), Pressable: element("button"), TextInput: element("textarea") };
});
import TellStoryScreen from "../app/tell-story";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  delete process.env.EXPO_PUBLIC_USE_API_STORY_REPOSITORY;
  boundary.params = { projectId: "actual-project", count: "3", live: "1" };
  boundary.progress = { status: "ready", total: 3, done: 3, failed: 0, ready: true, finished: true };
  boundary.start.mockResolvedValue({ id: "job-1", proposalId: "proposal-1", status: "queued" });
  boundary.watch.mockReturnValue(vi.fn());
  boundary.fixtureCreate.mockResolvedValue({ planId: "demo" });
  boundary.apiRepository.mockReturnValue({ projectId: "actual-project" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<TellStoryScreen />)); }
async function type(text = "Our family trip") {
  const input = host.querySelector("textarea")!;
  await act(async () => { input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); });
}
function button(label: string) { return [...host.querySelectorAll("button")].find(el => el.textContent === label)!; }
async function click(label: string) { expect(button(label)).toBeTruthy(); await act(async () => button(label).click()); }
async function job(update: Record<string, unknown>) {
  expect(boundary.watch).toHaveBeenCalled();
  await act(async () => boundary.watch.mock.lastCall![2].onChange({ id: "job-1", proposalId: "proposal-1", ...update }));
}

describe("Tell AI the Story", () => {
  it("posts actual route identity, typed text and attached focus; waits for each planning stage before reviewing", async () => {
    await render(); await type(); await click("✨ Having fun"); await click("Find the moments");
    expect(boundary.start).toHaveBeenCalledWith("actual-project", "Our family trip", ["✨ Having fun"]);
    expect(boundary.push).not.toHaveBeenCalled();
    for (const [progress, label] of [["searching", "Searching your memories"], ["inspecting", "Inspecting the moments"], ["organizing", "Organizing your story"]]) {
      await job({ status: "running", progress });
      expect([...host.querySelectorAll('[role="status"]')].some(el => el.textContent?.includes(label))).toBe(true);
    }
    await job({ status: "succeeded" });
    expect(boundary.setRepository).not.toHaveBeenCalled();
    expect(boundary.push).toHaveBeenCalledWith("/review-moments?planId=proposal-1&repository=api&projectId=actual-project");
  });
  it("keeps ingest progress visible while the queued plan waits for readiness", async () => {
    boundary.progress = { status: "processing", total: 3, done: 1, failed: 0, ready: false, finished: false };
    boundary.start.mockResolvedValue({ id: "job-1", proposalId: "proposal-1", status: "waiting_for_ready" });
    await render(); await type(); await click("Find the moments");
    expect(host.textContent).toContain("Getting your memories ready: 1 of 3");
    expect(host.textContent).toContain("Waiting for your memories to be ready");
    expect(boundary.push).not.toHaveBeenCalled();
  });
  it("shows a failed job reason and retries with the existing intent", async () => {
    await render(); await type(); await click("Find the moments");
    await job({ status: "failed", reason: "Could not find usable moments" });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not find usable moments");
    await click("Try again");
    expect(boundary.start).toHaveBeenCalledTimes(2);
    expect(boundary.start).toHaveBeenLastCalledWith("actual-project", "Our family trip", []);
    expect(boundary.push).not.toHaveBeenCalled();
  });
  it("prevents planning for failed or collecting projects and explains why", async () => {
    boundary.progress = { status: "failed", total: 3, done: 3, failed: 3, ready: false, finished: true };
    await render(); await type();
    expect(host.textContent).toContain("Planning is unavailable because none of your memories could be read");
    expect(button("Find the moments").disabled).toBe(true);
    boundary.progress = { ...boundary.progress, status: "collecting", finished: false };
    await render();
    expect(host.textContent).toContain("Finish adding your memories before planning");
    expect(button("Find the moments").disabled).toBe(true);
    expect(boundary.start).not.toHaveBeenCalled();
  });
  it("reconnects to the same job after a listener error without creating another plan", async () => {
    await render(); await type(); await click("Find the moments");
    await act(async () => boundary.watch.mock.lastCall![2].onError(new Error("Connection lost")));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Connection lost");
    await click("Reconnect");
    expect(boundary.watch).toHaveBeenLastCalledWith("actual-project", "job-1", expect.any(Object));
    expect(boundary.start).toHaveBeenCalledTimes(1);
    await job({ status: "succeeded" });
    expect(boundary.push).toHaveBeenCalledOnce();
  });
  it("surfaces rejected submissions and permits retry", async () => {
    boundary.start.mockRejectedValueOnce(new Error("Planning service unavailable"));
    await render(); await type(); await click("Find the moments");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Planning service unavailable");
    await click("Try again");
    expect(boundary.start).toHaveBeenCalledTimes(2);
  });
  it("explains server readiness rejection even when project progress cannot be read", async () => {
    boundary.progress = null;
    boundary.start.mockRejectedValueOnce(new Error("project_failed"));
    await render(); await type(); await click("Find the moments");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Planning is unavailable because none of your memories could be read");
  });
  it("preserves fixture submission without creating or observing a live job", async () => {
    boundary.params = { projectId: "p1", count: "3" }; boundary.progress = null;
    await render(); await type(); await click("✨ Having fun"); await click("Find the moments");
    expect(boundary.fixtureCreate).toHaveBeenCalledWith("Our family trip\n\nFocus on: ✨ Having fun", ["p1"]);
    expect(boundary.push).toHaveBeenCalledWith("/review-moments?planId=demo&repository=fixture");
    expect(boundary.start).not.toHaveBeenCalled(); expect(boundary.watch).not.toHaveBeenCalled();
  });
  it("requires an actual project id in the live flow", async () => {
    boundary.params = { live: "1" }; boundary.progress = null;
    await render(); await type();
    expect(button("Find the moments").disabled).toBe(true);
    expect(host.textContent).toContain("Choose your memories before planning");
  });
  it("ignores a pending submission from project A after switching to B", async () => {
    let resolve!: (value: any) => void;
    boundary.start.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await render(); await type(); await click("Find the moments");
    boundary.params = { projectId: "project-B", live: "1" };
    await render(); await type("B story");
    expect(button("Find the moments").disabled).toBe(false);
    await act(async () => resolve({ id: "job-A", proposalId: "proposal-A", status: "queued" }));
    expect(boundary.watch).not.toHaveBeenCalled();
    await click("Find the moments");
    expect(boundary.start).toHaveBeenLastCalledWith("project-B", "B story", []);
    expect(boundary.watch).toHaveBeenLastCalledWith("project-B", "job-1", expect.any(Object));
  });
  it("discards the old subscription and reconnect state on a project switch", async () => {
    await render(); await type(); await click("Find the moments");
    const oldListener = boundary.watch.mock.lastCall![2];
    const stop = boundary.watch.mock.results[0].value;
    await act(async () => oldListener.onError(new Error("Connection lost")));
    boundary.params = { projectId: "project-B", live: "1" };
    await render(); await type("B story");
    expect(host.textContent).not.toContain("Connection lost");
    expect(stop).toHaveBeenCalled();
    await act(async () => oldListener.onChange({ id: "job-1", proposalId: "proposal-A", status: "succeeded" }));
    expect(boundary.push).not.toHaveBeenCalled();
    expect(boundary.watch).toHaveBeenCalledTimes(1);
    await click("Find the moments");
    expect(boundary.start).toHaveBeenLastCalledWith("project-B", "B story", []);
  });
  it("can enter the fixture flow after completing live planning", async () => {
    await render(); await type(); await click("Find the moments"); await job({ status: "succeeded" });
    boundary.params = { projectId: "fixture-project" };
    await render(); await type("Fixture story"); await click("Find the moments");
    expect(boundary.fixtureCreate).toHaveBeenCalledWith("Fixture story", ["fixture-project"]);
    expect(boundary.push).toHaveBeenLastCalledWith("/review-moments?planId=demo&repository=fixture");
    expect(boundary.setRepository).not.toHaveBeenCalled();
  });
});
