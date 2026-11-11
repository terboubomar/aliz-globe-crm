import { beforeEach, describe, expect, it, vi } from "vitest";

// Read-only Google ratings through the Places API (New), with a fake Google.
const db = vi.hoisted(() => ({ updates: [] as { id: string; patch: unknown }[] }));
vi.mock("@/functions/core.server", () => ({
  admin: async () => ({
    from: () => ({
      update: (patch: unknown) => ({
        eq: (_k: string, id: string) => {
          db.updates.push({ id, patch });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

import {
  branchPlace,
  linkPlace,
  placesConfigured,
  resetPlacesCache,
  searchPlaces,
} from "@/functions/places.server";

type Call = { url: string; headers: Headers; body: unknown };
function google(status = 200) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    if (status !== 200)
      return new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status });
    if (url.endsWith("/places:searchText"))
      return new Response(
        JSON.stringify({
          places: [
            {
              id: "ChIJabc1234567",
              displayName: { text: "برجر واقف" },
              formattedAddress: "الدمام",
              rating: 4.4,
              userRatingCount: 812,
            },
          ],
        }),
      );
    return new Response(
      JSON.stringify({
        id: "ChIJabc1234567",
        displayName: { text: "برجر واقف" },
        rating: 4.4,
        userRatingCount: 812,
        googleMapsUri: "https://maps.google.com/?cid=1",
        googleMapsLinks: {
          reviewsUri: "https://maps.google.com/?cid=1&reviews",
          writeAReviewUri: "https://g.page/r/x/review",
        },
        reviews: [
          {
            rating: 2,
            text: { text: "الطلب وصل بارد" },
            relativePublishTimeDescription: "قبل يومين",
            publishTime: "2026-11-09T10:00:00Z",
            googleMapsUri: "https://maps.google.com/review/1",
            authorAttribution: { displayName: "سارة", uri: "https://maps.google.com/u/1" },
          },
        ],
      }),
    );
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

beforeEach(() => {
  process.env["GOOGLE_PLACES_API_KEY"] = "test-places-key-0123456789";
  db.updates = [];
  resetPlacesCache();
});

describe("Google ratings (Places API, read-only)", () => {
  it("needs the API key", () => {
    expect(placesConfigured()).toBe(true);
    delete process.env["GOOGLE_PLACES_API_KEY"];
    expect(placesConfigured()).toBe(false);
  });

  it("searches places in Arabic, Saudi Arabia first, with a field mask", async () => {
    const { fetcher, calls } = google();
    const found = await searchPlaces("برجر واقف الدمام", fetcher);
    expect(found).toEqual([
      { placeId: "ChIJabc1234567", name: "برجر واقف", address: "الدمام", rating: 4.4, total: 812 },
    ]);
    expect(calls[0]!.headers.get("X-Goog-Api-Key")).toBe("test-places-key-0123456789");
    expect(calls[0]!.headers.get("X-Goog-FieldMask")).toContain("places.id");
    expect(calls[0]!.body).toMatchObject({ languageCode: "ar", regionCode: "SA" });
  });

  it("reads the rating and latest reviews live and keeps them 30 minutes in memory", async () => {
    const { fetcher, calls } = google();
    const place = await branchPlace("b1", "ChIJabc1234567", { fetcher });
    expect(place).toMatchObject({
      rating: 4.4,
      total: 812,
      reviewsUrl: "https://maps.google.com/?cid=1&reviews",
      writeReviewUrl: "https://g.page/r/x/review",
    });
    expect(place.reviews[0]).toMatchObject({
      author: "سارة",
      rating: 2,
      text: "الطلب وصل بارد",
      when: "قبل يومين",
    });
    expect(calls[0]!.url).toContain("/places/ChIJabc1234567?languageCode=ar");
    await branchPlace("b1", "ChIJabc1234567", { fetcher });
    expect(calls).toHaveLength(1);
    await branchPlace("b1", "ChIJabc1234567", { fetcher, fresh: true });
    expect(calls).toHaveLength(2);
  });

  it("explains a refused key and stores only the place id", async () => {
    await expect(searchPlaces("x y", google(403).fetcher)).rejects.toThrow("Places API (New)");
    await linkPlace("b1", "ChIJabc1234567");
    expect(db.updates).toEqual([{ id: "b1", patch: { google_place_id: "ChIJabc1234567" } }]);
  });
});
