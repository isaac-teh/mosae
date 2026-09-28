// Public-place naming. Coordinates remain on media facts and are never shown.
export type PlaceLevel = "landmark" | "area" | "city" | "lodging";
export type Place = { name: string; level: PlaceLevel; country: string | null };
export type GeocodeResult = { name: string; types: string[]; country?: string | null };
export interface PlaceResolver { resolve(point: { lat: number; lng: number }): Promise<Place | null>; }

const PRIVATE = new Set(["premise", "subpremise", "street_address", "street_number", "route", "postal_code", "plus_code"]);
const LANDMARK = new Set(["tourist_attraction", "zoo", "amusement_park", "aquarium", "museum", "park", "natural_feature", "point_of_interest", "establishment", "stadium", "place_of_worship", "shopping_mall"]);
const AREA = new Set(["neighborhood", "sublocality", "sublocality_level_1", "colloquial_area"]);
const CITY = new Set(["locality", "administrative_area_level_1", "postal_town"]);

export function publicPlace(results: GeocodeResult[]): Place | null {
  const safe = results.filter((result) => !result.types.some((type) => PRIVATE.has(type)));
  const find = (types: Set<string>) => safe.find((result) => result.types.some((type) => types.has(type)));
  const country = results.find((result) => result.types.includes("country"))?.name ?? results.find((result) => result.country)?.country ?? null;
  const place = (result: GeocodeResult, level: PlaceLevel): Place => ({ name: result.name, level, country });
  // Lodging comes first by plan ruling: a hotel is more specific than nearby landmarks.
  const lodging = find(new Set(["lodging"]));
  if (lodging) return place(lodging, "lodging");
  const landmark = find(LANDMARK);
  if (landmark) return place(landmark, "landmark");
  const area = find(AREA);
  if (area) return place(area, "area");
  const city = find(CITY);
  return city ? place(city, "city") : null;
}

const key = ({ lat, lng }: { lat: number; lng: number }) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

export function fixturePlaceResolver(table: Record<string, GeocodeResult[]>): PlaceResolver {
  return { resolve: async (point) => table[key(point)] ? publicPlace(table[key(point)]!) : null };
}

/** Production reverse geocoding through Google's Geocoding API. */
export function googlePlaceResolver(apiKey: string, fetchImpl: typeof fetch = fetch): PlaceResolver {
  return {
    async resolve({ lat, lng }) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
      const body = await (await fetchImpl(url)).json() as { results?: { formatted_address: string; types: string[]; address_components: { long_name: string; types: string[] }[] }[] };
      return publicPlace((body.results ?? []).map((result) => ({
        name: result.address_components[0]?.long_name ?? result.formatted_address,
        types: result.types,
        country: result.address_components.find((component) => component.types.includes("country"))?.long_name ?? null,
      })));
    },
  };
}
