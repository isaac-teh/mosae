import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectCharacters } from "../lib/characters";

const boundary = vi.hoisted(() => ({
  params: {} as any,
  navigate: vi.fn(),
  getProjectCharacters: vi.fn(async () => ({ shots: [] })),
  assignCharacter: vi.fn(async () => ({ faceId: "f", name: "x" })),
  getAssetThumbnailUrl: vi.fn(async () => "https://signed.example/thumb.jpg"),
  setFocusCharacters: vi.fn(async () => "plan-2"),
}));

// Type the mocks so test bodies can pass typed payloads without `as any` noise.
const getProjectCharacters = boundary.getProjectCharacters as unknown as ReturnType<typeof vi.fn> & ((projectId: string) => Promise<ProjectCharacters>);
const assignCharacter = boundary.assignCharacter as unknown as ReturnType<typeof vi.fn> & (
  (projectId: string, shotId: string, input: { faceId: string; name?: string | null; role?: "MAIN" | "SUPPORTING" }) => Promise<{ faceId: string; characterId?: string | null; name?: string | null; role?: "MAIN" | "SUPPORTING" }>
);

vi.mock("@/lib/characters", () => ({
  getProjectCharacters: boundary.getProjectCharacters,
  assignCharacter: boundary.assignCharacter,
  getAssetThumbnailUrl: boundary.getAssetThumbnailUrl,
  setFocusCharacters: boundary.setFocusCharacters,
}));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => boundary.params, useRouter: () => ({ navigate: boundary.navigate }) }));
vi.mock("@/lib/useStepBack", () => ({ useStepBack: () => vi.fn() }));
vi.mock("@/components/StepHeader", () => ({ StepHeader: () => null }));
vi.mock("@/components/PrimaryButton", () => ({ PrimaryButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => React.createElement("button", { "aria-label": `save:${label}`, onClick: onPress, disabled }) }));
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
  // Simulate the backend: once a character has been assigned, the reload
  // reflects that assignment on shot-1-f0 (mirrors real server state).
  getProjectCharacters.mockImplementation(async () => ({ shots: [
    { shotId: "shot-1", assetId: "asset-1", faces: [
      { faceId: "shot-1-f0", bbox: [0.1, 0.1, 0.3, 0.3] as [number, number, number, number], characterId: null, name: boundary.assignCharacter.mock.calls.length > 0 ? "Alice" : null, role: undefined },
      { faceId: "shot-1-f1", bbox: [0.4, 0.4, 0.6, 0.6] as [number, number, number, number], characterId: null, name: null, role: undefined },
    ]},
    { shotId: "shot-2", assetId: "asset-2", faces: [{ faceId: "shot-2-f0", bbox: [0.2, 0.2, 0.4, 0.4] as [number, number, number, number], characterId: null, name: null, role: undefined }] },
  ]}));
  assignCharacter.mockResolvedValue({ faceId: "shot-1-f0", characterId: "char-live-project-alice", name: "Alice", role: undefined });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function render() { await act(async () => root.render(<CharacterPickerScreen />)); }
// Flush fire-and-forget promise chains (load/save) that run outside React's scheduler.
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); }

function buttonByAriaLabel(label: string) { return host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement; }
async function clickByAriaLabel(label: string) { const el = buttonByAriaLabel(label); expect(el).not.toBeNull(); await act(async () => el!.click()); }
async function type(text = "Alice") {
  const input = host.querySelector("input")!;
  await act(async () => { input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("Character Picker", () => {
  it("loads faces grouped by shot and shows an add-person control for each unassigned crop", async () => {
    await render();
    expect(host.textContent).toContain("Who's in your film?");
    expect(buttonByAriaLabel("Add a person to shot 1, face 1")).not.toBeNull();
    expect(buttonByAriaLabel("Add a person to shot 2, face 1")).not.toBeNull();
    expect(boundary.getProjectCharacters).toHaveBeenCalledWith("live-project");
  });

  it("saves a name via the client method and refreshes the grid after assignment", async () => {
    await render();
    await clickByAriaLabel("Add a person to shot 1, face 1");

    await type("Alice");
    const save = buttonByAriaLabel("save:Save");
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    await flush();

    expect(boundary.assignCharacter).toHaveBeenCalledWith("live-project", "shot-1", { faceId: "shot-1-f0", name: "Alice", role: undefined });
    // Grid reloaded after the assignment.
    expect(boundary.getProjectCharacters).toHaveBeenCalledTimes(2);
    expect(buttonByAriaLabel("Continue to 2 unassigned faces")).not.toBeNull();
  });

  it("disables Save while the draft name is empty and enables it once texted", async () => {
    await render();
    await clickByAriaLabel("Add a person to shot 1, face 1");

    let save = buttonByAriaLabel("save:Save");
    expect(save.disabled).toBe(true);

    await type("Bob");
    save = buttonByAriaLabel("save:Save");
    expect(save.disabled).toBe(false);
  });

  it("lets the user pick a role before saving", async () => {
    await render();
    await clickByAriaLabel("Add a person to shot 1, face 1");
    await type("Grandpa");

    const mainRadio = buttonByAriaLabel("Set role to MAIN") as HTMLButtonElement;
    expect(mainRadio.getAttribute("aria-checked")).toBe("false");
    await act(async () => mainRadio.click());

    let save = buttonByAriaLabel("save:Save");
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    await flush();
    expect(boundary.assignCharacter).toHaveBeenLastCalledWith("live-project", "shot-1", { faceId: "shot-1-f0", name: "Grandpa", role: "MAIN" });
  });

  it("shows an error state with retry when the faces cannot be loaded", async () => {
    boundary.getProjectCharacters.mockImplementation(async () => { throw new Error("not_found"); });
    await render();
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("not_found");
    await clickByAriaLabel("Retry");
    await flush();
    expect(boundary.getProjectCharacters).toHaveBeenCalledTimes(2);
  });

  it("shows an empty-state message when the project has no faces", async () => {
    getProjectCharacters.mockResolvedValue(faces([]));
    await render();
    await flush();
    expect(host.textContent).toContain("No faces were detected");
    expect(buttonByAriaLabel("Add a person to shot 1, face 1")).toBeNull();
  });

  it("navigates forward only after at least one character is assigned", async () => {
    await render();
    // Continue button disabled while nothing is assigned.
    const continueBtn = buttonByAriaLabel("Assign a person to continue");
    expect(continueBtn.disabled).toBe(true);

    await clickByAriaLabel("Add a person to shot 1, face 1");
    await type("Alice");
    let save = buttonByAriaLabel("save:Save");
    await act(async () => save.click());
    await flush();

    const continueBtn2 = buttonByAriaLabel("Continue to 2 unassigned faces");
    expect(continueBtn2.disabled).toBe(false);
    await act(async () => continueBtn2.click());
    expect(boundary.navigate).toHaveBeenCalledWith("/review-moments?planId=plan-1&repository=api&projectId=live-project");
  });
  /**
   * The whole point of the MAIN role: it must reach the plan. The planner reads
   * `constraints.focusCharacterIds` and folds those people's shots into the
   * must-include set, so a picker that collects roles without sending them
   * leaves the feature inert.
   */
  it("sends the distinct MAIN characters as focus ids before moving on", async () => {
    getProjectCharacters.mockResolvedValue(faces([
      { shotId: "shot-1", assetId: "asset-1", faces: [
        { faceId: "shot-1-f0", characterId: "char-mom", name: "Mom", role: "MAIN" },
        { faceId: "shot-1-f1", characterId: "char-kid", name: "Kid", role: "SUPPORTING" },
      ]},
      // The same person again: one focus id, not two.
      { shotId: "shot-2", assetId: "asset-2", faces: [
        { faceId: "shot-2-f0", characterId: "char-mom", name: "Mom", role: "MAIN" },
      ]},
    ]));
    await render();
    await flush();

    await clickByAriaLabel("Continue to 0 unassigned faces");
    await flush();

    expect(boundary.setFocusCharacters).toHaveBeenCalledWith("live-project", "plan-1", ["char-mom"]);
    // Recording the focus revises the proposal, so the next screen must be
    // handed the id that came back, not the one the picker started from.
    expect(boundary.navigate).toHaveBeenCalledWith("/review-moments?planId=plan-2&repository=api&projectId=live-project");
  });

  it("moves on without a focus call when nobody is marked MAIN", async () => {
    getProjectCharacters.mockResolvedValue(faces([
      { shotId: "shot-1", assetId: "asset-1", faces: [
        { faceId: "shot-1-f0", characterId: "char-kid", name: "Kid", role: "SUPPORTING" },
      ]},
    ]));
    await render();
    await flush();

    await clickByAriaLabel("Continue to 0 unassigned faces");
    await flush();

    expect(boundary.setFocusCharacters).not.toHaveBeenCalled();
    expect(boundary.navigate).toHaveBeenCalledWith("/review-moments?planId=plan-1&repository=api&projectId=live-project");
  });

  it("keeps the user on the picker and says so when the focus call fails", async () => {
    getProjectCharacters.mockResolvedValue(faces([
      { shotId: "shot-1", assetId: "asset-1", faces: [
        { faceId: "shot-1-f0", characterId: "char-mom", name: "Mom", role: "MAIN" },
      ]},
    ]));
    boundary.setFocusCharacters.mockRejectedValueOnce(new Error("invalid_constraints"));
    await render();
    await flush();

    await clickByAriaLabel("Continue to 0 unassigned faces");
    await flush();

    expect(boundary.navigate).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("invalid_constraints");
  });

  it("crops each face from its shot's signed thumbnail", async () => {
    await render();
    await flush();
    const images = host.querySelectorAll("img");
    expect(images.length).toBe(3);
    expect(images[0].getAttribute("src")).toBe("https://signed.example/thumb.jpg");
    expect(boundary.getAssetThumbnailUrl).toHaveBeenCalledWith("live-project", "asset-1");
    expect(boundary.getAssetThumbnailUrl).toHaveBeenCalledWith("live-project", "asset-2");
  });
});
