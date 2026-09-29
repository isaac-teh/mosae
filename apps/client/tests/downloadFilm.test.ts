import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Share: { share: vi.fn() } }));
import { downloadFilm } from "../lib/downloadFilm";

describe("downloadFilm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the video and shares a named MP4 file when file sharing is supported", async () => {
    const file = new File(["video"], "Tokyo Trip.mp4", { type: "video/mp4" });
    const share = vi.fn(async () => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(file, { status: 200, headers: { "Content-Type": "video/mp4" } })));
    vi.stubGlobal("navigator", { canShare: vi.fn(() => true), share });
    const states: boolean[] = [];

    await downloadFilm("https://storage.example/film", "Tokyo Trip", (preparing) => states.push(preparing));

    expect(fetch).toHaveBeenCalledWith("https://storage.example/film");
    expect(share).toHaveBeenCalledWith({ files: [expect.objectContaining({ name: "Tokyo Trip.mp4", type: "video/mp4" })] });
    expect(states).toEqual([true, false]);
  });

  it("downloads a blob through a hidden anchor when file sharing is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("video", { status: 200, headers: { "Content-Type": "video/mp4" } })));
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:film"), revokeObjectURL: vi.fn() });
    let clicked: HTMLAnchorElement | null = null;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked = this; });

    await downloadFilm("https://storage.example/film", "Family: Tokyo");

    const downloadedAnchor = clicked as unknown as HTMLAnchorElement;
    expect(click).toHaveBeenCalledOnce();
    expect(downloadedAnchor.download).toBe("Family Tokyo.mp4");
    expect(downloadedAnchor.href).toBe("blob:film");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("reports failures and never opens the source URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    vi.stubGlobal("navigator", {});
    const states: boolean[] = [];

    await expect(downloadFilm("https://storage.example/film", "Trip", (preparing) => states.push(preparing))).rejects.toThrow("download_failed");

    expect(states).toEqual([true, false]);
  });
});
