import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureStoryRepository } from "../../../packages/core/src/story/fixtureRepository";
import type { StoryPlan } from "@mosae/core";

const boundary = vi.hoisted(() => ({ repository: {} as any, navigate: vi.fn() }));
vi.mock("@mosae/core", () => ({ getStoryRepository: () => boundary.repository }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({ planId: "initial" }), useRouter: () => ({ navigate: boundary.navigate }) }));
vi.mock("@/lib/useStepBack", () => ({ useStepBack: () => vi.fn() }));
vi.mock("@/lib/demoAssets", () => ({ demoImage: (key: string) => {
  if (key.includes(":")) throw new Error("URI used as demo key");
  return 1;
} }));
vi.mock("@/components/sceneIcons", () => ({ ArchivalSparkleIcon: () => null, AddPhotoIcon: () => null, AddMoreIcon: () => null, ContinueArrowIcon: () => null, HeartIcon: () => null }));
vi.mock("@/components/icons", () => ({ CheckIcon: () => null }));
vi.mock("@/components/StepHeader", () => ({ StepHeader: () => null }));
vi.mock("@/components/BottomTabBar", () => ({ BottomTabBar: () => null }));
vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, onChangeText, numberOfLines, accessibilityLabel, source, resizeMode, keyboardShouldPersistTaps, placeholderTextColor, ...props }: any) =>
    React.createElement(tag, { ...props, onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined, ...(tag === "img" ? { src: source?.uri, alt: accessibilityLabel } : {}) }, children);
  return { View: element("div"), ScrollView: element("div"), Text: element("span"), Pressable: element("button"), Image: element("img"), TextInput: element("input") };
});

import ReviewMomentsScreen from "../app/review-moments";
import CuratedTimelineScreen from "../app/curated-timeline";

let root: Root;
let host: HTMLDivElement;
let plan: StoryPlan;
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  plan = await createFixtureStoryRepository().getPlan("demo");
  plan = { ...plan, planId: "initial", moments: Array.from({ length: 7 }, (_, i) => ({ ...plan.moments[0], id: `real-${i}`, title: `Memory ${i}`, imageKey: `https://images.example/${i}.jpg` })), chapters: [] };
  delete plan.totalMomentCount;
  delete plan.timelineOtherPhotoCount;
  boundary.repository = {
    getPlan: vi.fn(async () => structuredClone(plan)),
    setMomentSelected: vi.fn(async (id, momentId, selected) => ({ ...structuredClone(plan), planId: "selected-revision", moments: plan.moments.map(m => m.id === momentId ? { ...m, selected } : m) })),
    setMomentFavorite: vi.fn(async () => ({ ...structuredClone(plan), planId: "favorite-revision" })),
    reviseMoments: vi.fn(async () => ({ ...structuredClone(plan), planId: "revised", timelineIntro: { ...plan.timelineIntro, headline: "Revised story" } })),
  };
  boundary.navigate.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(Component: React.ComponentType) { await act(async () => root.render(<Component />)); }
async function click(label: string) {
  const button = host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  expect(button).not.toBeNull();
  await act(async () => button.click());
}

describe("review screens", () => {
  it.each([0, 1, 7])("renders all %i moments and their URI images", async (count) => {
    plan.moments = plan.moments.slice(0, count);
    await render(ReviewMomentsScreen);
    expect(host.querySelectorAll('[role="checkbox"]')).toHaveLength(count);
    expect([...host.querySelectorAll("img")].map(image => image.src)).toEqual(Array.from({ length: count }, (_, i) => `https://images.example/${i}.jpg`));
  });
  it("uses the returned selection revision for subsequent writes and navigation", async () => {
    await render(ReviewMomentsScreen);
    await click("Select Memory 0");
    expect(host.querySelector('[aria-label="Select Memory 0"]')?.getAttribute("aria-checked")).toBe("false");
    await click("Select Memory 1");
    expect(boundary.repository.setMomentSelected).toHaveBeenLastCalledWith("selected-revision", "real-1", false);
    await click("Continue to curated timeline");
    expect(boundary.navigate).toHaveBeenCalledWith("/curated-timeline?planId=selected-revision");
  });
  it("repeats hero / paired half / hero rows without dropping the final half row", async () => {
    await render(ReviewMomentsScreen);
    const cards = [...host.querySelectorAll('[role="checkbox"]')].map(checkbox => checkbox.closest(".bg-white")!);
    expect(cards.map(card => card.classList.contains("w-full"))).toEqual([true, false, false, true, true, false, false]);
    expect(cards[1].parentElement).toBe(cards[2].parentElement);
    expect(cards[5].parentElement).toBe(cards[6].parentElement);
  });
  it("uses the returned favorite revision when continuing", async () => {
    await render(ReviewMomentsScreen);
    await click("Favorite Memory 0");
    expect(boundary.repository.setMomentFavorite).toHaveBeenCalledWith("initial", "real-0", true);
    await click("Continue to curated timeline");
    expect(boundary.navigate).toHaveBeenCalledWith("/curated-timeline?planId=favorite-revision");
  });
  it("keeps the plan after a failed edit and allows retry", async () => {
    boundary.repository.setMomentSelected.mockRejectedValueOnce(new Error("Connection lost"));
    await render(ReviewMomentsScreen);
    await click("Select Memory 0");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Connection lost");
    expect(host.querySelector('[aria-label="Select Memory 0"]')?.getAttribute("aria-checked")).toBe("true");
    await click("Select Memory 0");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[aria-label="Select Memory 0"]')?.getAttribute("aria-checked")).toBe("false");
  });
  it("blocks overlapping writes and navigation until the current revision returns", async () => {
    let resolve!: (value: StoryPlan) => void;
    boundary.repository.setMomentSelected.mockImplementationOnce(() => new Promise<StoryPlan>(done => { resolve = done; }));
    await render(ReviewMomentsScreen);
    await click("Select Memory 0");
    await click("Select Memory 1");
    await click("Continue to curated timeline");
    expect(boundary.repository.setMomentSelected).toHaveBeenCalledTimes(1);
    expect(boundary.navigate).not.toHaveBeenCalled();
    await act(async () => resolve({ ...plan, planId: "latest" }));
    await click("Select Memory 1");
    expect(boundary.repository.setMomentSelected).toHaveBeenLastCalledWith("latest", "real-1", false);
  });
  it("renders chapter membership/order, metadata and the actual selected count", async () => {
    plan.chapters = [
      { id: "c-a", dayLabel: "Arrival", title: "Our first walk", subtitle: "Together", badge: { label: "Opening", tone: "neutral" }, dotColor: "#123456", momentIds: ["real-5", "missing", "real-0", "real-3"] },
      { id: "c-b", dayLabel: "Farewell", title: "Homeward", subtitle: "Ending", badge: { label: "Finale", tone: "milestone" }, dotColor: "#654321", momentIds: ["real-2"] },
    ];
    plan.moments[0].selected = false;
    await render(CuratedTimelineScreen);
    expect([...host.querySelectorAll('[role="checkbox"]')].map(el => el.getAttribute("aria-label"))).toEqual(["Select Memory 5", "Select Memory 0", "Select Memory 3", "Select Memory 2"]);
    expect(host.textContent).toContain("Our first walk • Together");
    expect(host.textContent).toContain("6 Moments Selected");
    expect(host.textContent).not.toContain("11:30 AM");
  });
  it("installs revised plans and directs subsequent edits and continue to that revision", async () => {
    plan.chapters = [{ id: "c", dayLabel: "Today", title: "Trip", subtitle: "Together", badge: { label: "Chapter 1", tone: "neutral" }, dotColor: "#123456", momentIds: ["real-0"] }];
    await render(CuratedTimelineScreen);
    const input = host.querySelector("input")!;
    await act(async () => { input.value = "More family"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Update moments");
    expect(host.textContent).toContain("Revised story");
    await click("Select Memory 0");
    expect(boundary.repository.setMomentSelected).toHaveBeenCalledWith("revised", "real-0", false);
    await click("Continue");
    expect(boundary.navigate).toHaveBeenCalledWith("/create?planId=selected-revision");
  });
});
