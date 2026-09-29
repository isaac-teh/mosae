import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { createNominatimRateLimiter, fixturePlaceResolver, googlePlaceResolver, nominatimPlaceResolver, placeFromNominatim, publicPlace } from "./place.js";

describe("publicPlace", () => {
  it("prefers landmark, allows lodging, and keeps lodging precedence when both are returned", () => {
    expect(publicPlace([{ name: "Singapore Zoo", types: ["zoo"] }, { name: "Singapore", types: ["locality"] }, { name: "Singapore", types: ["country"] }])).toEqual({ name: "Singapore Zoo", level: "landmark", country: "Singapore" });
    expect(publicPlace([{ name: "Rasa Sentosa", types: ["lodging"] }])).toEqual({ name: "Rasa Sentosa", level: "lodging", country: null });
    expect(publicPlace([{ name: "Singapore Zoo", types: ["zoo"] }, { name: "Rasa Sentosa", types: ["lodging"] }])).toEqual({ name: "Rasa Sentosa", level: "lodging", country: null });
  });
  it("rejects residential premises and street addresses, falling back to area", () => {
    expect(publicPlace([
      { name: "Blk 88 Telok Blangah Heights", types: ["premise", "street_address"] },
      { name: "Telok Blangah", types: ["neighborhood"] }, { name: "Singapore", types: ["locality"] },
    ])).toEqual({ name: "Telok Blangah", level: "area", country: null });
  });
  it("falls back to city and returns null for private-only results", () => {
    expect(publicPlace([{ name: "Singapore", types: ["locality"] }])).toEqual({ name: "Singapore", level: "city", country: null });
    expect(publicPlace([{ name: "12 Some Road", types: ["route"] }])).toBeNull();
  });
});

describe("Nominatim public place mapping", () => {
  it.each([
    [{ category: "natural", type: "beach", name: "Siloso Beach", address: { beach: "Siloso Beach", city: "Singapore", country: "Singapore" } }, { name: "Siloso Beach", level: "landmark", country: "Singapore" }],
    [{ category: "tourism", type: "zoo", name: "Singapore Zoo", address: { zoo: "Singapore Zoo", city: "Singapore", country: "Singapore" } }, { name: "Singapore Zoo", level: "landmark", country: "Singapore" }],
    [{ category: "tourism", type: "hotel", name: "Rasa Sentosa", address: { hotel: "Rasa Sentosa", city: "Singapore", country: "Singapore" } }, { name: "Rasa Sentosa", level: "lodging", country: "Singapore" }],
    [{ category: "place", type: "suburb", name: "Sentosa", address: { suburb: "Sentosa", city: "Singapore", country: "Singapore" } }, { name: "Sentosa", level: "area", country: "Singapore" }],
    [{ category: "place", type: "city", name: "Singapore", address: { city: "Singapore", country: "Singapore" } }, { name: "Singapore", level: "city", country: "Singapore" }],
    [{ category: "highway", type: "residential", name: "Some Road", display_name: "12 Some Road, 123456", address: { house_number: "12", road: "Some Road", postcode: "123456", suburb: "Sentosa", city: "Singapore", country: "Singapore" } }, { name: "Singapore", level: "city", country: "Singapore" }],
  ] as const)("maps a public Nominatim result without an address", (body, expected) => {
    expect(placeFromNominatim(body)).toEqual(expected);
  });
});

describe("Nominatim resolver", () => {
  function fakeCache() {
    const docs = new Map<string, { place: unknown; timestamp: Date }>();
    const db = { collection: (name: string) => {
      expect(name).toBe("placeCache");
      return { doc: (id: string) => ({
        get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
        set: async (value: { place: unknown; timestamp: Date }) => { docs.set(id, value); },
      }) };
    } } as unknown as Firestore;
    return { db, docs };
  }

  it("sends the identifying User-Agent and caches the rounded location across calls", async () => {
    const { db, docs } = fakeCache();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ category: "tourism", type: "zoo", name: "Singapore Zoo", address: { city: "Singapore", country: "Singapore" } }), { status: 200 }));
    const resolver = nominatimPlaceResolver(db, "https://mosae.example/contact", { fetchImpl: fetchMock as unknown as typeof fetch, limit: (job) => job(), now: () => 123 });
    expect(await resolver.resolve({ lat: 1.40431, lng: 103.79301 })).toEqual({ name: "Singapore Zoo", level: "landmark", country: "Singapore" });
    expect(await resolver.resolve({ lat: 1.40432, lng: 103.79302 })).toEqual({ name: "Singapore Zoo", level: "landmark", country: "Singapore" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("format=jsonv2&lat=1.40431&lon=103.79301&zoom=18&addressdetails=1&accept-language=en");
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { "User-Agent": "Mosae/1.0 (+https://mosae.example/contact)" } });
    expect(docs.get("1.404,103.793")).toMatchObject({ place: { name: "Singapore Zoo" }, timestamp: new Date(123) });
  });

  it("shares an in-flight lookup and caches a null result", async () => {
    const { db } = fakeCache();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ category: "highway", type: "residential", address: { road: "Home Road", country: "Singapore" } }), { status: 200 })) as unknown as typeof fetch;
    const resolver = nominatimPlaceResolver(db, "ops@example.test", { fetchImpl, limit: (job) => job() });
    expect(await Promise.all([resolver.resolve({ lat: 1, lng: 2 }), resolver.resolve({ lat: 1.0001, lng: 2.0001 })])).toEqual([null, null]);
    expect(await resolver.resolve({ lat: 1, lng: 2 })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("spaces uncached requests at least one second apart", async () => {
    let clock = 0;
    const starts: number[] = [];
    const limiter = createNominatimRateLimiter(() => clock, async (ms) => { clock += ms; });
    await Promise.all([0, 1, 2].map(() => limiter(async () => { starts.push(clock); return null; })));
    expect(starts).toEqual([0, 1000, 2000]);
  });
});

describe("place resolvers", () => {
  it("looks up fixture coordinates rounded to 3dp", async () => {
    const resolver = fixturePlaceResolver({ "1.404,103.793": [{ name: "Singapore Zoo", types: ["zoo"] }, { name: "Singapore", types: ["country"] }] });
    expect(await resolver.resolve({ lat: 1.40432, lng: 103.79301 })).toEqual({ name: "Singapore Zoo", level: "landmark", country: "Singapore" });
    expect(await resolver.resolve({ lat: 0, lng: 0 })).toBeNull();
  });
  it("maps Google results through the public-place rule", async () => {
    const fake = (async () => ({ json: async () => ({ results: [
      { formatted_address: "88 X Rd", types: ["street_address"], address_components: [{ long_name: "88 X Rd", types: [] }] },
      { formatted_address: "Sentosa", types: ["sublocality"], address_components: [{ long_name: "Sentosa", types: ["sublocality"] }, { long_name: "Singapore", types: ["country"] }] },
    ] }) })) as unknown as typeof fetch;
    expect(await googlePlaceResolver("k", fake).resolve({ lat: 1, lng: 2 })).toEqual({ name: "Sentosa", level: "area", country: "Singapore" });
  });
});
