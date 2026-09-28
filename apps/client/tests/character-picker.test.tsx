import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectCharacters } from "../lib/characters";

const boundary = vi.hoisted(() => ({
  params: {} as any,
  navigate: vi.fn(),
  getProjectCharacters: vi.fn(async () => ({ shots: [] })),
  getCast: vi.fn(async () => null as any),
  confirmCast: vi.fn(async () => ({ cast: {}, proposalId: "plan-2" }) as any),
  getAssetThumbnailUrl: vi.fn(async () => "https://signed.example/thumb.jpg"),
}));

// Type the mocks so test bodies can pass typed payloads without `as any` noise.
const getProjectCharacters = boundary.getProjectCharacters as unknown as ReturnType<typeof vi.fn> & ((projectId: string) => Promise<ProjectCharacters>);

vi.mock("@/lib/characters", () => ({
  getProjectCharacters: boundary.getProjectCharacters,
  getCast: boundary.getCast,
  confirmCast: boundary.confirmCast,
  getAssetThumbnailUrl: boundary.getAssetThumbnailUrl,
}));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => boundary.params, useRouter: () => ({ navigate: boundary.navigate }) }));
vi.mock("@/lib/storyFlow", () => ({ useStoryFlow: () => ({ route: (path: string, params?: Record<string, unknown>) => ({ path, params }) }) }));
vi.mock("@/lib/useStepBack", () => ({ useStepBack: () => vi.fn() }));
vi.mock("@/components/StepHeader", () => ({ StepHeader: () => null }));
vi.mock("react-native-svg", () => ({ default: () => null, Path: () => null }));
vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, onChangeText, autoFocus, placeholder, placeholderTextColor, multiline, textAlignVertical, role, ariaChecked, ...props }: any) =>
    React.createElement(tag, { ...props, onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined, role, ariaChecked }, children);
    // react-native-web turns `source={{ uri }}` into an <img src>; mirror that
  // so a crop asserts on the URL the screen actually resolved.
  const image = ({ source, accessibilityIgnoresInvertColors, ...props }: any) =>
    React.createElement("img", { ...props, src: source?.uri });
  return { View: element("div"), ScrollView: element("div"), Text: element("span"), Pressable: element("button"), TextInput: element("input"), Image: image };
});

import CharacterPickerScreen from "../app/character-picker";

let root: Root;
let host: HTMLDivElement;

function faces(shots: ProjectCharacters["shots"]) { return { projectId: "live-project", shots }; }

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  boundary.params = { planId: "plan-1", repository: "api", projectId: "live-project" };
  boundary.navigate.mockReset();
  const box = (n: number) => [0.1 * n, 0.1, 0.1 * n + 0.2, 0.3] as [number, number, number, number];
  getProjectCharacters.mockImplementation(async () => ({ shots: [
    { shotId: "shot-1", assetId: "asset-1", faces: [
      { faceId: "f-dad", bbox: box(1), characterId: "p-dad" },
      { faceId: "f-kid", bbox: box(2), characterId: "p-kid" },
    ]},
    { shotId: "shot-2", assetId: "asset-2", faces: [
      { faceId: "f-kid-2", bbox: box(3), characterId: "p-dad" },
      { faceId: "f-stranger", bbox: box(4), characterId: null },
    ]},
  ]}));
  boundary.getCast.mockResolvedValue({
    people: [
      { personId: "p-dad", role: "parent", appearances: 2, subjectCount: 2, faceIds: [] },
      { personId: "p-kid", role: "child", appearances: 1, subjectCount: 1, faceIds: [] },
    ],
    core: ["p-dad", "p-kid"], focus: ["p-kid"],
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function render() { await act(async () => root.render(<CharacterPickerScreen />)); }
// Flush fire-and-forget promise chains (load/save) that run outside React's scheduler.
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); }

function buttonByAriaLabel(label: string) { return host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement; }
async function clickByAriaLabel(label: string) { const el = buttonByAriaLabel(label); expect(el).not.toBeNull(); await act(async () => el!.click()); }
async function type(text: string, index = 0) {
  const input = host.querySelectorAll("input")[index] as HTMLInputElement;
  await act(async () => { input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("Character Picker", () => {
  it("opens with the cast the director found, focus first, and strangers set aside", async () => {
    await render(); await flush();
    expect(host.textContent).toContain("We found 2 people");
    const cards = [...host.querySelectorAll('[role="radiogroup"]')].map((group) => group.getAttribute("aria-label"));
    expect(cards).toEqual(["Your child's role", "A parent's role"]);
    expect(host.textContent).toContain("Others in your photos");
    expect(buttonByAriaLabel("Centre the film on Your child").getAttribute("aria-checked")).toBe("true");
  });

  it("confirms edits, moves and leave-outs, and continues with the revised plan", async () => {
    await render(); await flush();
    await type("Mia", 0);
    await clickByAriaLabel("Leave A parent out");
    expect(host.textContent).toContain("won't be used");
    // The dad card's second crop is really the child.
    await clickByAriaLabel("Move A parent photo 2 to someone else");
    await clickByAriaLabel("Move to Mia");
    await clickByAriaLabel("Looks right");
    await flush();
    expect(boundary.confirmCast).toHaveBeenCalledWith("live-project", {
      people: [
        { personId: "p-dad", role: "parent", excluded: true },
        { personId: "p-kid", role: "child", excluded: false, name: "Mia" },
      ],
      focus: ["p-kid"],
      moves: [{ faceId: "f-kid-2", personId: "p-kid" }],
      proposalId: "plan-1",
    });
    expect(boundary.navigate).toHaveBeenCalledWith({ path: "/review-moments", params: { planId: "plan-2" } });
  });

  it("drops a left-out person from the focus", async () => {
    await render(); await flush();
    await clickByAriaLabel("Leave Your child out");
    await clickByAriaLabel("Looks right"); await flush();
    expect((boundary.confirmCast.mock.calls as any[][])[0]![1].focus).toEqual([]);
    expect(host.textContent).not.toContain("Centre the film on Your child");
  });

  it("brings a stranger into the film as a new person", async () => {
    await render(); await flush();
    await clickByAriaLabel("Move unknown photo 1 to someone else");
    await clickByAriaLabel("Move to a new person");
    await clickByAriaLabel("Looks right"); await flush();
    const body = (boundary.confirmCast.mock.calls as any[][])[0]![1];
    expect(body.moves).toContainEqual({ faceId: "f-stranger", personId: "p-new-3" });
    expect(body.people.map((person: { personId: string }) => person.personId)).toContain("p-new-3");
  });

  it("skips without saving and keeps the plan it was given", async () => {
    await render(); await flush();
    await clickByAriaLabel("Skip");
    expect(boundary.confirmCast).not.toHaveBeenCalled();
    expect(boundary.navigate).toHaveBeenCalledWith({ path: "/review-moments", params: { planId: "plan-1" } });
  });

  it("stays on the picker and says so when confirming fails", async () => {
    boundary.confirmCast.mockRejectedValueOnce(new Error("Unable to save who is in your film"));
    await render(); await flush();
    await clickByAriaLabel("Looks right"); await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Unable to save who is in your film");
    expect(boundary.navigate).not.toHaveBeenCalled();
  });

  it("with no cast yet, offers only skip", async () => {
    boundary.getCast.mockResolvedValueOnce(null);
    await render(); await flush();
    expect(host.textContent).toContain("didn't find anyone");
    expect(buttonByAriaLabel("Looks right").disabled).toBe(true);
  });

  it("shows an error state with retry when the faces cannot be loaded", async () => {
    getProjectCharacters.mockRejectedValueOnce(new Error("Unable to load your characters"));
    await render(); await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Unable to load your characters");
    expect(buttonByAriaLabel("Retry")).not.toBeNull();
  });

  it("crops each face from its shot's signed thumbnail", async () => {
    await render(); await flush();
    const img = host.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://signed.example/thumb.jpg");
  });
});
