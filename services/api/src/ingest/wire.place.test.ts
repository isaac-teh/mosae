import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { loadPlaceResolver } from "./wire.js";

const db = { collection: () => ({ doc: () => ({
  get: async () => ({ exists: false }),
  set: async () => undefined,
}) }) } as unknown as Firestore;

describe("ingest place resolver selection", () => {
  it("keeps the trip1-v2 fixtures as the dev default", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("unexpected network call"); });
    const resolver = await loadPlaceResolver(db, {}, fetchMock as unknown as typeof fetch);
    expect(await resolver.resolve({ lat: 1.404, lng: 103.793 })).toMatchObject({ level: "landmark" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("defaults to Nominatim in production", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ category: "place", type: "city", address: { city: "Singapore", country: "Singapore" } }), { status: 200 }));
    const resolver = await loadPlaceResolver(db, { NODE_ENV: "production", NOMINATIM_CONTACT: "ops@example.test" }, fetchMock as unknown as typeof fetch);
    expect(await resolver.resolve({ lat: 1, lng: 2 })).toEqual({ name: "Singapore", level: "city", country: "Singapore" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("nominatim.openstreetmap.org");
  });

  it("lets an explicitly configured Google key take precedence", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ json: async () => ({ results: [{ formatted_address: "Singapore", types: ["locality"], address_components: [{ long_name: "Singapore", types: ["locality"] }] }] }) }));
    const resolver = await loadPlaceResolver(db, { NODE_ENV: "production", GOOGLE_MAPS_API_KEY: "secret" }, fetchMock as unknown as typeof fetch);
    expect(await resolver.resolve({ lat: 1, lng: 2 })).toMatchObject({ name: "Singapore", level: "city" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("maps.googleapis.com");
  });
});
