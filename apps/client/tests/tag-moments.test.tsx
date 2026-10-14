import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ back: vi.fn(), getProjectMoments: vi.fn(), savePersonMoments: vi.fn() }));
vi.mock("expo-router", () => ({ useRouter: () => ({ back: mocks.back }), useLocalSearchParams: () => ({ projectId: "project-1", personId: "p-missed-1", name: "Grandpa", source: "missed" }) }));
vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, ...props }: any) => React.createElement(tag, { ...props, "aria-label": accessibilityLabel, onClick: onPress }, children);
  return {
    ActivityIndicator: element("span"), FlatList: ({ data, renderItem }: any) => React.createElement("div", null, ...data.map((item: any) => renderItem({ item }))),
    Image: ({ source, ...props }: any) => React.createElement("img", { ...props, src: source.uri }), Pressable: element("button"), Text: element("span"), View: element("div"),
  };
});
vi.mock("@/lib/projectMoments", () => ({ getProjectMoments: (...args: any[]) => mocks.getProjectMoments(...args), savePersonMoments: (...args: any[]) => mocks.savePersonMoments(...args) }));
vi.mock("@/lib/storyFlow", () => ({ useStoryFlow: () => ({ flow: { repository: "api" } }) }));

import TagMomentsScreen from "../app/tag-moments";
import { consumeTaggedPersonResult } from "../lib/taggedPersonResult";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.back.mockReset();
  mocks.savePersonMoments.mockReset().mockResolvedValue(undefined);
  mocks.getProjectMoments.mockReset().mockResolvedValue([
    { shotId: "shot-1", thumbnailUrl: "https://thumb/1", kind: "photo", durationSec: null, dayIndex: 1, personIds: [] },
    { shotId: "shot-2", thumbnailUrl: "https://thumb/2", kind: "photo", durationSec: null, dayIndex: 1, personIds: [] },
  ]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("Tag moments screen", () => {
  it("saves missed-person tags on Done and returns a result for chat to re-derive", async () => {
    await act(async () => root.render(<TagMomentsScreen />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const tagButtons = [...host.querySelectorAll('button[aria-label="Tag moment"]')];
    expect(tagButtons).toHaveLength(2);
    await act(async () => { tagButtons[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { tagButtons[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const done = [...host.querySelectorAll("button")].find((button) => button.textContent === "Done");
    expect(done).toBeTruthy();
    await act(async () => { done!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(mocks.savePersonMoments).toHaveBeenCalledWith("project-1", "p-missed-1", "Grandpa", ["shot-1", "shot-2"], [], ["https://thumb/1", "https://thumb/2"]);
    expect(consumeTaggedPersonResult()).toMatchObject({ personId: "p-missed-1", name: "Grandpa", momentCount: 2, isMissed: true, shotIds: ["shot-1", "shot-2"], sampleUris: ["https://thumb/1", "https://thumb/2"] });
    expect(mocks.back).toHaveBeenCalledOnce();
  });

  it("shows a friendly message when cast validation rejects a gallery save", async () => {
    mocks.savePersonMoments.mockRejectedValueOnce(new Error("invalid_cast"));
    await act(async () => root.render(<TagMomentsScreen />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const tag = host.querySelector('button[aria-label="Tag moment"]');
    await act(async () => { tag!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const done = [...host.querySelectorAll("button")].find((button) => button.textContent === "Done");
    await act(async () => { done!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host.textContent).toContain("We couldn't save these tags. Please try again.");
    expect(host.textContent).not.toContain("invalid_cast");
    expect(mocks.back).not.toHaveBeenCalled();
  });
});
