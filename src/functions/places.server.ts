// Server-only: Google ratings and latest reviews per branch, read-only, through
// the Places API (New). No Google approval is needed, only GOOGLE_PLACES_API_KEY.
import { admin } from "./core.server";

/*
 * Each branch is linked once to its Google Maps place (search by name, pick
 * the right result); only the place id is stored. Ratings and reviews are
 * read live from Google when someone opens them, and kept in memory for
 * 30 minutes to limit cost. Google's terms do not allow storing review
 * content, and the Places API returns at most the 5 most relevant reviews.
 * Replying is not possible here: the link opens the place in Google Maps.
 */

const env = (k: string) => (process.env[k] ?? "").trim();
const BASE = "https://places.googleapis.com/v1";
const CACHE_MS = 30 * 60_000;

export const placesConfigured = () => env("GOOGLE_PLACES_API_KEY").length >= 20;

type Json = Record<string, unknown>;
class PlacesError extends Error {}

async function call(fetcher: typeof fetch, path: string, fieldMask: string, body?: unknown) {
  const res = await fetcher(BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Goog-Api-Key": env("GOOGLE_PLACES_API_KEY"),
      "X-Goog-FieldMask": fieldMask,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const err = json["error"] as { message?: string; status?: string } | undefined;
    throw new PlacesError(
      res.status === 403
        ? "رفض Google المفتاح: تأكد من تفعيل Places API (New) لهذا المفتاح وأن الفوترة مفعّلة"
        : `Google ${res.status}: ${err?.message ?? err?.status ?? "خطأ"}`,
    );
  }
  return json;
}

const text = (v: unknown) =>
  typeof v === "object" && v ? String((v as Json)["text"] ?? "") : String(v ?? "");

export type PlaceMatch = {
  placeId: string;
  name: string;
  address: string;
  rating: number | null;
  total: number;
};

/** Find a branch's Google Maps place by name (Arabic results, Saudi Arabia first). */
export async function searchPlaces(query: string, fetcher: typeof fetch = fetch) {
  const out = await call(
    fetcher,
    "/places:searchText",
    "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount",
    { textQuery: query.slice(0, 200), languageCode: "ar", regionCode: "SA", pageSize: 8 },
  );
  return ((out["places"] as Json[] | undefined) ?? []).map((p): PlaceMatch => ({
    placeId: String(p["id"]),
    name: text(p["displayName"]),
    address: String(p["formattedAddress"] ?? ""),
    rating: typeof p["rating"] === "number" ? p["rating"] : null,
    total: Number(p["userRatingCount"] ?? 0),
  }));
}

export async function linkPlace(branchId: string, placeId: string | null) {
  const db = await admin();
  const { error } = await db
    .from("branches")
    .update({ google_place_id: placeId } as never)
    .eq("id", branchId);
  if (error)
    throw new PlacesError(
      error.message.includes("duplicate") ? "هذا المكان مربوط بفرع آخر" : error.message,
    );
  cache.delete(branchId);
}

export type PlaceReview = {
  author: string;
  authorUrl: string | null;
  photo: string | null;
  rating: number;
  text: string;
  when: string;
  publishedAt: string | null;
  url: string | null;
};
export type BranchPlace = {
  placeId: string;
  name: string;
  rating: number | null;
  total: number;
  mapsUrl: string | null;
  reviewsUrl: string | null;
  writeReviewUrl: string;
  reviews: PlaceReview[];
  fetchedAt: string;
};

const cache = new Map<string, { at: number; place: BranchPlace; placeId: string }>();
export const resetPlacesCache = () => cache.clear();

/** Rating and latest reviews of one branch, live from Google (cached 30 minutes). */
export async function branchPlace(
  branchId: string,
  placeId: string,
  opts: { fresh?: boolean; fetcher?: typeof fetch } = {},
): Promise<BranchPlace> {
  const hit = cache.get(branchId);
  if (hit && hit.placeId === placeId && !opts.fresh && Date.now() - hit.at < CACHE_MS)
    return hit.place;
  const p = await call(
    opts.fetcher ?? fetch,
    `/places/${encodeURIComponent(placeId)}?languageCode=ar&regionCode=SA`,
    "id,displayName,rating,userRatingCount,googleMapsUri,googleMapsLinks,reviews",
  );
  const links = (p["googleMapsLinks"] ?? {}) as Json;
  const place: BranchPlace = {
    placeId,
    name: text(p["displayName"]),
    rating: typeof p["rating"] === "number" ? p["rating"] : null,
    total: Number(p["userRatingCount"] ?? 0),
    mapsUrl: (p["googleMapsUri"] as string) ?? null,
    reviewsUrl: (links["reviewsUri"] as string) ?? (p["googleMapsUri"] as string) ?? null,
    writeReviewUrl:
      (links["writeAReviewUri"] as string) ??
      `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
    reviews: ((p["reviews"] as Json[] | undefined) ?? []).map((r) => {
      const a = (r["authorAttribution"] ?? {}) as Json;
      return {
        author: String(a["displayName"] ?? "مستخدم Google"),
        authorUrl: (a["uri"] as string) ?? null,
        photo: (a["photoUri"] as string) ?? null,
        rating: Number(r["rating"] ?? 0),
        text: text(r["text"]) || text(r["originalText"]),
        when: String(r["relativePublishTimeDescription"] ?? ""),
        publishedAt: (r["publishTime"] as string) ?? null,
        url: (r["googleMapsUri"] as string) ?? null,
      };
    }),
    fetchedAt: new Date().toISOString(),
  };
  cache.set(branchId, { at: Date.now(), place, placeId });
  return place;
}

export { PlacesError };
