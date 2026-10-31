import { describe, expect, it } from "vitest";

describe("data retention", () => {
  it("removes personal details after 2 years and photos after 6 months", async () => {
    const { cutoffs, RETENTION } = await import("@/functions/retention.server");
    const c = cutoffs(new Date("2026-11-01T00:00:00Z"));
    expect(RETENTION).toEqual({ personalYears: 2, photoMonths: 6 });
    expect(c.personal.toISOString()).toBe("2024-11-01T00:00:00.000Z");
    expect(c.photos.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(c.markers.toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });
});
