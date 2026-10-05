import React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
const router = vi.hoisted(() => ({ canGoBack: vi.fn(), back: vi.fn(), replace: vi.fn() }));
vi.mock("expo-router", () => ({ useRouter: () => router }));
import { useStepBack } from "../lib/useStepBack";
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>; let run: () => void;
function Harness() { run = useStepBack("/"); return null; }
afterEach(async () => { await React.act(async () => root?.unmount()); host?.remove(); vi.clearAllMocks(); });
async function setup() { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); await React.act(async () => root.render(<Harness />)); }
describe("useStepBack", () => {
  it("returns to its fallback route when a deep link has no history", async () => {
    router.canGoBack.mockReturnValue(false); await setup(); await React.act(async () => run());
    expect(router.replace).toHaveBeenCalledWith("/"); expect(router.back).not.toHaveBeenCalled();
  });
  it("uses history when it is available", async () => {
    router.canGoBack.mockReturnValue(true); await setup(); await React.act(async () => run());
    expect(router.back).toHaveBeenCalledOnce(); expect(router.replace).not.toHaveBeenCalled();
  });
});
