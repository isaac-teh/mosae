// Public-place naming. Coordinates remain on media facts and are never shown.
import type { Firestore } from "firebase-admin/firestore";
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

type NominatimResult = {
  category?: string;
  class?: string;
  type?: string;
  name?: string;
  address?: Record<string, unknown>;
};

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const first = (address: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const key of keys) {
    const value = text(address[key]);
    if (value) return value;
  }
  return null;
};

/** Uses named public features only; never uses display_name, road, house_number or postcode. */
export function placeFromNominatim(result: NominatimResult): Place | null {
  const address = result.address ?? {};
  const country = text(address.country);
  const category = result.category ?? result.class;
  const type = result.type;
  const city = () => {
    const name = first(address, "city", "town", "village") ?? (category === "place" && ["city", "town", "village"].includes(type ?? "") ? text(result.name) : null);
    return name ? { name, level: "city" as const, country } : null;
  };
  // A residential reverse hit must not reveal its street or even neighbourhood.
  if (category === "highway" || ["house", "residential", "road", "street", "postcode"].includes(type ?? "")) return city();

  const lodging = first(address, "hotel", "hostel", "motel", "guest_house", "resort");
  if (lodging || (category === "tourism" && ["hotel", "hostel", "motel", "guest_house", "resort"].includes(type ?? ""))) {
    const name = lodging ?? text(result.name);
    if (name) return { name, level: "lodging", country };
  }

  const landmark = first(address, "beach", "zoo", "park", "attraction", "museum", "aquarium", "theme_park", "tourism", "leisure", "amenity");
  if (landmark || ["tourism", "leisure", "amenity"].includes(category ?? "") || (category === "natural" && type === "beach")) {
    const name = landmark ?? text(result.name);
    if (name) return { name, level: "landmark", country };
  }

  const area = first(address, "suburb", "neighbourhood", "quarter", "city_district") ?? (category === "place" && ["suburb", "neighbourhood", "quarter"].includes(type ?? "") ? text(result.name) : null);
  if (area) return { name: area, level: "area", country };
  return city();
}

type Limit = <T>(job: () => Promise<T>) => Promise<T>;

/** One serial queue per API process, spacing request starts by at least 1000 ms. */
export function createNominatimRateLimiter(
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Limit {
  let nextAt = 0;
  let tail: Promise<void> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = async () => {
      let delay = nextAt - now();
      while (delay > 0) {
        await wait(delay);
        delay = nextAt - now();
      }
      nextAt = now() + 1000;
      return job();
    };
    const result = tail.then(run, run);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

// Policy: https://operations.osmfoundation.org/policies/nominatim/ — max 1
// request/s for the whole app, identifying User-Agent, caching and attribution.
// Deploy caps the API at one instance; change provider or use a distributed
// limiter before raising that cap.
const sharedNominatimLimit = createNominatimRateLimiter();

function identifyingUserAgent(contact: string): string {
  const value = contact.trim();
  if (/[\r\n]/.test(value)) throw new Error("invalid NOMINATIM_CONTACT");
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  let url = false;
  try { const parsed = new URL(value); url = ["https:", "http:"].includes(parsed.protocol) && !!parsed.hostname; } catch { /* email may be valid */ }
  if (!email && !url) throw new Error("NOMINATIM_CONTACT must be an email or URL");
  return `Mosae/1.0 (+${value})`;
}

export function nominatimPlaceResolver(
  db: Firestore,
  contact: string,
  options: { fetchImpl?: typeof fetch; limit?: Limit; now?: () => number } = {},
): PlaceResolver {
  const userAgent = identifyingUserAgent(contact);
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = options.limit ?? sharedNominatimLimit;
  const now = options.now ?? Date.now;
  const inFlight = new Map<string, Promise<Place | null>>();
  return {
    resolve(point) {
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return Promise.resolve(null);
      const id = key(point);
      const pending = inFlight.get(id);
      if (pending) return pending;
      const lookup = async (): Promise<Place | null> => {
        const ref = db.collection("placeCache").doc(id);
        const cached = await ref.get();
        if (cached.exists && Object.prototype.hasOwnProperty.call(cached.data() ?? {}, "place")) {
          return (cached.data()?.place as Place | null) ?? null;
        }
        const url = new URL("https://nominatim.openstreetmap.org/reverse");
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("lat", String(point.lat));
        url.searchParams.set("lon", String(point.lng));
        url.searchParams.set("zoom", "18");
        url.searchParams.set("addressdetails", "1");
        url.searchParams.set("accept-language", "en");
        const place = await limit(async () => {
          const response = await fetchImpl(url.toString(), { headers: { "User-Agent": userAgent } });
          if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
          return placeFromNominatim(await response.json() as NominatimResult);
        });
        await ref.set({ place, timestamp: new Date(now()) });
        return place;
      };
      const result = lookup().finally(() => { inFlight.delete(id); });
      inFlight.set(id, result);
      return result;
    },
  };
}
