import { describe, expect, it, vi } from "vitest";
import { PendingPreviewUrls } from "../lib/pendingPreviewUrls";

describe("PendingPreviewUrls", () => {
  it("keeps one URL per File across equivalent pending arrays and revokes only removed files", () => {
    const first = new File(["first"], "first.jpg", { type: "image/jpeg" });
    const second = new File(["second"], "second.jpg", { type: "image/jpeg" });
    let nextUrl = 0;
    const create = vi.fn(() => `blob:preview-${++nextUrl}`);
    const revoke = vi.fn();
    const previews = new PendingPreviewUrls(create, revoke);

    const firstUrl = previews.get(first);
    expect(previews.get(first)).toBe(firstUrl);
    const secondUrl = previews.get(second);
    expect(secondUrl).toBe("blob:preview-2");
    expect(create).toHaveBeenCalledTimes(2);

    previews.retain([{ file: first }, { file: second }].map(({ file }) => file));
    expect(previews.get(first)).toBe(firstUrl);
    expect(revoke).not.toHaveBeenCalled();

    previews.retain([second]);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(firstUrl);
    previews.dispose();
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenLastCalledWith(secondUrl);
  });
});
