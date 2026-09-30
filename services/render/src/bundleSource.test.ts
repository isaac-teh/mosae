import { describe, expect, it, vi } from "vitest";
import { createBundleSource } from "./bundleSource.js";

describe("createBundleSource", () => {
  it("uses the configured prebuilt bundle without invoking the bundler", async () => {
    const bundle = vi.fn(async () => "local-bundle");
    const source = createBundleSource({ serveUrl: "/app/remotion-bundle", production: false, bundle });
    await expect(source()).resolves.toBe("/app/remotion-bundle");
    expect(bundle).not.toHaveBeenCalled();
  });

  it("fails clearly when production starts without the image bundle", () => {
    expect(() => createBundleSource({ serveUrl: undefined, production: true, bundle: vi.fn() })).toThrow(/MOSAE_REMOTION_SERVE_URL/);
  });

  it("keeps local development bundling available", async () => {
    const bundle = vi.fn(async () => "local-bundle");
    const source = createBundleSource({ serveUrl: undefined, production: false, bundle });
    await expect(source()).resolves.toBe("local-bundle");
    expect(bundle).toHaveBeenCalledOnce();
  });
});
