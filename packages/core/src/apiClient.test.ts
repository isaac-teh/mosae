import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth", () => ({ ensureSignedIn: vi.fn(async () => ({ getIdToken: async () => "tok" })) }));
const { configureCore } = await import("./config");
const { apiPost, ApiError } = await import("./apiClient");

describe("apiPost", () => {
  beforeEach(() => {
    configureCore({ apiBaseUrl: "http://api.test", firebase: {}, useEmulators: false });
  });

  it("posts JSON with the bearer token to the configured base URL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiPost("/api/x", { a: 1 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
      body: JSON.stringify({ a: 1 }),
    });
  });

  it("throws ApiError with the server error code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_entry" }), { status: 400 })));
    await expect(apiPost("/api/x")).rejects.toMatchObject({ status: 400, code: "invalid_entry" });
    await expect(apiPost("/api/x")).rejects.toBeInstanceOf(ApiError);
  });
});
