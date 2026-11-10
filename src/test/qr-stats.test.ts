import { describe, expect, it } from "vitest";
import { daysBetween, summarizeQr } from "@/lib/qr-stats";

describe("QR stats", () => {
  it("lists every day of the period", () => {
    expect(daysBetween("2026-11-01", "2026-11-03")).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
  });
  it("adds up visits, complaints and suggestions", () => {
    const s = summarizeQr(
      {
        scans: [
          { day: "2026-11-01", brandId: "waqf", n: 30 },
          { day: "2026-11-02", brandId: "waqf", n: 10 },
          { day: "2026-11-02", brandId: "kabab", n: 10 },
        ],
        submissions: [
          { day: "2026-11-01", brandId: "waqf", branchId: "b1", suggestion: false, n: 3 },
          { day: "2026-11-01", brandId: "waqf", branchId: "b1", suggestion: true, n: 1 },
          { day: "2026-11-02", brandId: "waqf", branchId: "b2", suggestion: false, n: 1 },
        ],
        hours: [
          { hour: 20, n: 40 },
          { hour: 13, n: 10 },
        ],
      },
      "2026-11-01",
      "2026-11-03",
    );
    expect(s.scans).toBe(50);
    expect(s.complaints).toBe(4);
    expect(s.suggestions).toBe(1);
    expect(s.conversion).toBe(10);
    expect(s.days.map((d) => d.scans)).toEqual([30, 20, 0]);
    expect(s.brands[0]).toMatchObject({
      brandId: "waqf",
      scans: 40,
      complaints: 4,
      suggestions: 1,
      conversion: 12.5,
    });
    expect(s.brands[1]).toMatchObject({ brandId: "kabab", conversion: 0 });
    expect(s.branches[0]).toMatchObject({ branchId: "b1", total: 4 });
    expect(s.busiestHour).toBe(20);
  });
  it("shows no rate without visits", () => {
    expect(
      summarizeQr({ scans: [], submissions: [], hours: [] }, "2026-11-01", "2026-11-01").conversion,
    ).toBeNull();
  });
});
