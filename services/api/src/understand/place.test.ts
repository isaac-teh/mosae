import { describe, expect, it } from "vitest";
import { fixturePlaceResolver, googlePlaceResolver, publicPlace } from "./place.js";

describe("publicPlace", () => {
  it("prefers landmark, allows lodging, and keeps lodging precedence when both are returned", () => {
    expect(publicPlace([{ name: "Singapore Zoo", types: ["zoo"] }, { name: "Singapore", types: ["locality"] }])).toEqual({ name: "Singapore Zoo", level: "landmark" });
    expect(publicPlace([{ name: "Rasa Sentosa", types: ["lodging"] }])).toEqual({ name: "Rasa Sentosa", level: "lodging" });
    expect(publicPlace([{ name: "Singapore Zoo", types: ["zoo"] }, { name: "Rasa Sentosa", types: ["lodging"] }])).toEqual({ name: "Rasa Sentosa", level: "lodging" });
  });
  it("rejects residential premises and street addresses, falling back to area", () => {
    expect(publicPlace([
      { name: "Blk 88 Telok Blangah Heights", types: ["premise", "street_address"] },
      { name: "Telok Blangah", types: ["neighborhood"] }, { name: "Singapore", types: ["locality"] },
    ])).toEqual({ name: "Telok Blangah", level: "area" });
  });
  it("falls back to city and returns null for private-only results", () => {
    expect(publicPlace([{ name: "Singapore", types: ["locality"] }])).toEqual({ name: "Singapore", level: "city" });
    expect(publicPlace([{ name: "12 Some Road", types: ["route"] }])).toBeNull();
  });
});

describe("place resolvers", () => {
  it("looks up fixture coordinates rounded to 3dp", async () => {
    const resolver = fixturePlaceResolver({ "1.404,103.793": [{ name: "Singapore Zoo", types: ["zoo"] }] });
    expect(await resolver.resolve({ lat: 1.40432, lng: 103.79301 })).toEqual({ name: "Singapore Zoo", level: "landmark" });
    expect(await resolver.resolve({ lat: 0, lng: 0 })).toBeNull();
  });
  it("maps Google results through the public-place rule", async () => {
    const fake = (async () => ({ json: async () => ({ results: [
      { formatted_address: "88 X Rd", types: ["street_address"], address_components: [{ long_name: "88 X Rd", types: [] }] },
      { formatted_address: "Sentosa", types: ["sublocality"], address_components: [{ long_name: "Sentosa", types: [] }] },
    ] }) })) as unknown as typeof fetch;
    expect(await googlePlaceResolver("k", fake).resolve({ lat: 1, lng: 2 })).toEqual({ name: "Sentosa", level: "area" });
  });
});
