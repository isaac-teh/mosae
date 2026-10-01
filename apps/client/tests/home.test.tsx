import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ films: [] as any[], listFilms: vi.fn(), uploadMedia: vi.fn(), push: vi.fn(), focusEffect: null as null | (() => void | (() => void)), repository: {} as any, flow: { repository: "api" as const, projectId: "" } }));
vi.mock("@/lib/startDemoTrip", () => ({ startDemoTrip: vi.fn(async () => {}) }));
vi.mock("@mosae/core", async (load) => ({ ...(await load<typeof import("@mosae/core")>()), getStoryRepository: () => ({ listFilms: state.listFilms }), uploadMedia: state.uploadMedia }));
vi.mock("@/components/MediaPicker", async () => {
  const ReactModule = await import("react");
  return { MediaPicker: ReactModule.forwardRef(({ onFiles }: { onFiles: (files: File[]) => void }, ref) => {
    ReactModule.useImperativeHandle(ref, () => ({ open: () => onFiles([new File(["photo"], "trip.jpg", { type: "image/jpeg" })]) }), [onFiles]);
    return null;
  }) };
});
vi.mock("@/lib/storyFlow", () => ({ useStoryFlow: () => ({ repository: state.repository, flow: state.flow }) }));
vi.mock("expo-router", async () => {
  const ReactModule = await import("react");
  return { useRouter: () => ({ push: state.push }), useFocusEffect: (effect: () => void | (() => void)) => ReactModule.useEffect(() => { state.focusEffect = effect; return effect(); }, [effect]) };
});
vi.mock("@/components/icons", () => ({ SettingsIcon: () => React.createElement("svg", { "data-settings-icon": "true" }), ChevronDownIcon: () => null, ArrowRightIcon: () => null, PlayIcon: () => null }));
vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, ...props }: any) => React.createElement(tag, { ...props, onClick: onPress }, children);
  return { View: element("div"), ScrollView: element("div"), Text: element("span"), Pressable: element("button"), Image: (props: any) => React.createElement("img", { src: props.source?.uri, alt: props.accessibilityLabel }) };
});

import Home from "../app/index";
import { startDemoTrip } from "@/lib/startDemoTrip";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  state.films = [];
  state.focusEffect = null;
  state.listFilms.mockImplementation(async () => state.films);
  state.uploadMedia.mockResolvedValue({ projectId: "uploaded-project", finished: 1, failed: 0 });
  state.repository = { listFilms: state.listFilms };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<Home />)); }

describe("Home", () => {
  it("uploads selected media from the picker and opens the director without Camera Roll", async () => {
    await render();
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("Create a new film"));
    await act(async () => button!.click());
    await act(async () => await Promise.resolve());
    expect(state.uploadMedia).toHaveBeenCalledWith(expect.arrayContaining([expect.any(File)]), expect.objectContaining({ mode: "memory" }));
    expect(state.push).toHaveBeenCalledWith({ pathname: "/director", params: { projectId: "uploaded-project", live: "1" } });
    expect(state.push).not.toHaveBeenCalledWith("/pick-memory");
  });

  it("starts the demo trip from Home", async () => {
    await render();
    const click = async (label: string) => {
      const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
      expect(button).toBeTruthy();
      await act(async () => button!.click());
    };
    await click("Try with a demo trip");
    expect(startDemoTrip).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startDemoTrip).mock.calls.every(([router]) => typeof router.push === "function")).toBe(true);
  });
  it("shows the empty home invitation, body copy and editable empty film state", async () => {
    await render();
    expect(host.textContent?.replace(/\s+/g, " ")).toContain("Many moments. One story.");
    expect(host.textContent).toContain("Bring in the photos and clips from a trip or celebration. You say what mattered. Mosaé shapes it into a film you can change at every step.");
    const createButtons = [...host.querySelectorAll("button")].filter(button => button.textContent?.includes("Create a new film"));
    expect(createButtons).toHaveLength(1);
    expect(createButtons[0]?.className).toContain("rounded-md");
    expect(createButtons[0]?.className).not.toContain("rounded-pill");
    expect(createButtons[0]?.parentElement?.className).not.toContain("bottom-0");
    expect(host.textContent).toContain("No films yet. Your first one will live here, and it stays editable.");
    expect(host.querySelectorAll('[data-testid="home-mosaic"] [data-mosaic-tile]')).toHaveLength(12);
    expect(host.querySelectorAll('[data-testid="home-mosaic"] [data-mosaic-tile="persimmon"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-testid="empty-films-icon"] > div')).toHaveLength(4);
    expect(host.querySelector('[aria-label="Settings"]')).toBeTruthy();
  });

  it("shows a two-column film grid, marks the newest just saved, and pins Create at the bottom", async () => {
    state.films = Array.from({ length: 6 }, (_, i) => ({ projectId: `p${i}`, filmId: `g${i}`, planId: `plan${i}`, title: `Film ${i}`, month: "Jun 2026", duration: "1:30", posterUrl: `https://image/${i}`, status: "saved", justSaved: i === 0 }));
    await render();
    expect(host.textContent).toContain("Your films");
    expect(host.textContent).toContain("6 films");
    expect(host.querySelectorAll('[data-film-grid="true"] > div')).toHaveLength(6);
    expect(host.textContent).toContain("Just saved");
    const createButtons = [...host.querySelectorAll("button")].filter(button => button.textContent?.includes("Create a new film"));
    expect(createButtons).toHaveLength(1);
    expect(createButtons[0]?.className).toContain("rounded-md");
    expect(createButtons[0]?.parentElement?.className).toContain("bottom-0");
    expect(host.querySelector('[data-testid="home-mosaic"]')).toBeNull();
    await act(async () => (host.querySelector('[data-film-grid="true"] button') as HTMLButtonElement).click());
    expect(state.push).toHaveBeenCalledWith("/save-film?repository=api&projectId=p0&filmId=g0");
  });

  it("refreshes the film list when Home regains focus after a film is saved", async () => {
    await render();
    expect(host.textContent).toContain("No films yet");
    state.films = [{ projectId: "p1", filmId: "f1", title: "Singapore Trip", month: "Jun 2026", duration: "0:30", justSaved: true }];
    await act(async () => {
      const cleanup = state.focusEffect?.();
      cleanup?.();
      state.focusEffect?.();
      await Promise.resolve();
    });
    expect(state.listFilms).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain("Just saved");
    expect(host.textContent).toContain("Singapore Trip");
  });

  it("lists saved, ready, rendering, and in-progress projects with the right destinations", async () => {
    state.films = [
      { projectId: "saved-project", filmId: "saved-gen", planId: "saved-plan", title: "Saved", month: "Sep 2026", duration: "0:30", posterUrl: "", status: "saved", justSaved: false },
      { projectId: "ready-project", filmId: "ready-gen", planId: "ready-plan", title: "Ready", month: "Sep 2026", duration: "0:30", posterUrl: "", status: "film-ready", justSaved: false, demo: true },
      { projectId: "render-project", filmId: "render-gen", planId: "render-plan", title: "Rendering", month: "Sep 2026", duration: "0:30", posterUrl: "", status: "rendering", justSaved: false },
      { projectId: "active-project", filmId: null, planId: "active-plan", title: "In progress", month: "Sep 2026", duration: "", posterUrl: "", status: "in-progress", justSaved: false },
    ];
    await render();

    expect(host.textContent).toContain("Film ready");
    expect(host.textContent).toContain("Rendering");
    expect(host.textContent).toContain("In progress");
    expect(host.textContent).toContain("Demo");
    const card = (title: string) => [...host.querySelectorAll('[data-film-grid] button')].find((button) => [...button.querySelectorAll("span")].some((span) => span.textContent === title)) as HTMLButtonElement;
    await act(async () => card("Saved").click());
    expect(state.push).toHaveBeenLastCalledWith("/save-film?repository=api&projectId=saved-project&filmId=saved-gen");
    await act(async () => card("Ready").click());
    expect(state.push).toHaveBeenLastCalledWith("/director?repository=api&projectId=ready-project");
    await act(async () => card("Rendering").click());
    expect(state.push).toHaveBeenLastCalledWith("/editor?repository=api&projectId=render-project&planId=render-plan&generationId=render-gen");
    await act(async () => card("In progress").click());
    expect(state.push).toHaveBeenLastCalledWith("/director?repository=api&projectId=active-project");
  });

});
