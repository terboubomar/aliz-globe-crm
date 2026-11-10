import { describe, expect, it } from "vitest";
import { REGIONS, branchesIn, citiesIn, regionLabel, regionsWith } from "@/lib/regions";

const branches = [
  { id: "1", name: "برجر واقف - سيهات", city: "سيهات", region: "EASTERN" },
  { id: "2", name: "برجر واقف - الخبر الشمالية", city: "الخبر", region: "EASTERN" },
  { id: "3", name: "برجر واقف - الخبر الراكة", city: "الخبر ", region: "EASTERN" },
  { id: "4", name: "برجر واقف - الملقا", city: "الرياض", region: "RIYADH" },
  { id: "5", name: "فرع بدون منطقة", city: "جدة", region: null },
];

describe("branch regions", () => {
  it("has Saudi Arabia's 13 regions with Arabic names", () => {
    expect(REGIONS).toHaveLength(13);
    expect(regionLabel("EASTERN")).toBe("المنطقة الشرقية");
    expect(regionLabel("NOPE")).toBe("");
  });

  it("offers only regions that have branches, in the official order", () => {
    expect(regionsWith(branches).map((r) => r.id)).toEqual(["RIYADH", "EASTERN"]);
  });

  it("lists each city once, trimmed, for the chosen region", () => {
    expect(citiesIn(branches, "EASTERN")).toEqual(["الخبر", "سيهات"]);
    expect(citiesIn(branches, "RIYADH")).toEqual(["الرياض"]);
  });

  it("finds the branches in a city (more than one means the customer picks)", () => {
    expect(branchesIn(branches, "EASTERN", "الخبر").map((b) => b.id)).toEqual(["2", "3"]);
    expect(branchesIn(branches, "EASTERN", "سيهات").map((b) => b.id)).toEqual(["1"]);
  });
});
