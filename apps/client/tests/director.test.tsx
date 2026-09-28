import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  const node = (tag: string) => ({ children, onPress, onChangeText, accessibilityLabel, editable, ...props }: any) => React.createElement(tag, { ...props, "aria-label": props["aria-label"] ?? accessibilityLabel, disabled: props.disabled ?? (editable === false ? true : undefined), onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined }, children);
  return { View: node("div"), ScrollView: node("div"), Text: node("span"), Pressable: node("button"), TextInput: node("input"), Image: ({ source, accessibilityLabel, ...props }: any) => React.createElement("img", { ...props, src: source?.uri, alt: accessibilityLabel }) };
});

const mocks = vi.hoisted(() => ({ repo: null as any, confirmCast: vi.fn() }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "project-1" }), useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("@mosae/core", async (importOriginal) => ({ ...(await importOriginal<typeof import("@mosae/core")>()), getStoryRepository: () => mocks.repo }));
vi.mock("@/lib/characters", () => ({ confirmCast: (...args: any[]) => mocks.confirmCast(...args) }));
import DirectorScreen from "../app/director";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function renderScreen() { await act(async () => root.render(<DirectorScreen />)); }
async function click(label: string) { const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label); expect(button).toBeTruthy(); await act(async () => button!.dispatchEvent(new MouseEvent("click", { bubbles: true }))); }
function hasText(text: string) { return host.textContent?.includes(text) ?? false; }
async function waitFor(check: () => void) { for (let i = 0; i < 40; i++) { try { check(); return; } catch { await act(async () => new Promise((resolve) => setTimeout(resolve, 10))); } } check(); }

const summary = (faces = true) => ({ total: 8, photos: 8, clips: 0, days: 2, dateRange: null, places: ["Tokyo"], country: "Japan", season: "late October", processed: { ingested: 8, understood: 8, faces: 4 }, ready: { summary: true, faces, plan: false } });
const people = [
  { personId: "person-1", name: null, role: null, momentCount: 212, sampleShotIds: ["a", "b"], days: [2, 3] },
  { personId: "person-2", name: null, role: null, momentCount: 90, sampleShotIds: ["c"], days: [1] },
];

function setup(options: { faces?: boolean; interpret?: () => Promise<any>; createPlan?: () => Promise<any> } = {}) {
  mocks.repo = {
    getSummary: vi.fn(async () => summary(options.faces ?? true)), getPeople: vi.fn(async () => people),
    createPlan: vi.fn(options.createPlan ?? (async () => ({ planId: "proposal-1" }))),
    interpret: vi.fn(options.interpret ?? (async () => ({ reply: "I understood the Japan trip.", change: { kind: "occasion", storyText: "Japan trip" } }))),
  };
  mocks.confirmCast.mockResolvedValue({ cast: { people: [] }, proposalId: "proposal-2" });
}

describe("Director chat", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the ready summary and starts the story intent when the occasion reply is tapped", async () => {
    setup(); await renderScreen();
    expect(hasText("I've looked through all 8")).toBe(true);
    await click("Yes, that's our story");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledWith("Tokyo", []));
    expect(hasText("Tokyo")).toBe(true);
  });

  it("shows people processing and Skip for now while faces are still pending", async () => {
    setup({ faces: false }); await renderScreen();
    await click("Yes, that's our story");
    expect(hasText("Finding the faces in your trip")).toBe(true);
    expect(hasText("Skip for now")).toBe(true);
  });

  it("saves the selected role and name before asking about the next person", async () => {
    setup(); await renderScreen();
    await click("Yes, that's our story");
    await click("My daughter");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalledWith("project-1", expect.objectContaining({ people: expect.arrayContaining([expect.objectContaining({ personId: "person-1", role: "child", name: "My daughter" })]) })));
    expect(hasText("One person appears in 90 moments. Who is this?")).toBe(true);
  });

  it("Skip for now advances past the people step", async () => {
    setup(); await renderScreen();
    await click("Yes, that's our story");
    await click("Skip for now");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalled());
  });

  it("interprets typed text and waits for an explicit confirmation before saving", async () => {
    setup(); await renderScreen();
    const composer = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "our family trip"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("→");
    await waitFor(() => expect(hasText("I understood the Japan trip.")).toBe(true));
    expect(mocks.repo.createPlan).not.toHaveBeenCalled();
    await click("Yes, that's right");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledWith("our family trip", []));
  });

  it("shows the unclear reply when interpretation fails and keeps the occasion reply usable", async () => {
    setup({ interpret: async () => { throw new Error("offline"); } }); await renderScreen();
    const composer = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "something"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("→");
    await waitFor(() => expect(hasText("I didn't catch that. Pick one below, or say it another way.")).toBe(true));
    expect(hasText("Yes, that's our story")).toBe(true);
    expect(mocks.repo.createPlan).not.toHaveBeenCalled();
  });

  it("shows Try again after a failed save and retries the save", async () => {
    let attempts = 0;
    setup({ createPlan: async () => { if (!attempts++) throw new Error("network"); return { planId: "proposal-1" }; } }); await renderScreen();
    await click("Yes, that's our story");
    await waitFor(() => expect(hasText("Try again")).toBe(true));
    await click("Try again");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledTimes(2));
  });
});
