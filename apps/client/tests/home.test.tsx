import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ films: [] as any[], listFilms: vi.fn(), push: vi.fn() }));
vi.mock("@mosae/core", async (load) => ({ ...(await load<typeof import("@mosae/core")>()), getStoryRepository: () => ({ listFilms: state.listFilms }) }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, ...props }: any) => React.createElement(tag, { ...props, onClick: onPress }, children);
  return { View: element("div"), ScrollView: element("div"), Text: element("span"), Pressable: element("button"), Image: (props: any) => React.createElement("img", { src: props.source?.uri, alt: props.accessibilityLabel }) };
});

import Home from "../app/index";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  state.films = [];
  state.listFilms.mockImplementation(async () => state.films);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<Home />)); }

describe("Home", () => {
  it("shows the empty home invitation, body copy and editable empty film state", async () => {
    await render();
    expect(host.textContent).toContain("Many moments. One story.");
    expect(host.textContent).toContain("Bring in the photos and clips from a trip or celebration. You say what mattered. Mosaé shapes it into a film you can change at every step.");
    expect(host.textContent).toContain("Create a new film");
    expect(host.textContent).toContain("No films yet. Your first one will live here, and it stays editable.");
  });

  it("shows a two-column film grid, marks the newest just saved, and pins Create at the bottom", async () => {
    state.films = Array.from({ length: 6 }, (_, i) => ({ projectId: `p${i}`, filmId: `g${i}`, title: `Film ${i}`, month: "Jun 2026", duration: "1:30", posterUrl: `https://image/${i}`, justSaved: i === 0 }));
    await render();
    expect(host.textContent).toContain("Your films");
    expect(host.textContent).toContain("6 films");
    expect(host.querySelectorAll('[data-film-grid="true"] > div')).toHaveLength(6);
    expect(host.textContent).toContain("Just saved");
    const cta = [...host.querySelectorAll("button")].reverse().find(button => button.textContent?.includes("Create a new film"));
    expect(cta?.parentElement?.className).toContain("bottom-0");
  });
});
