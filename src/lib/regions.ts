/** Saudi Arabia's 13 administrative regions, plus Bahrain, as stored on each branch. */
export const REGIONS = [
  { id: "RIYADH", label: "منطقة الرياض" },
  { id: "MAKKAH", label: "منطقة مكة المكرمة" },
  { id: "MADINAH", label: "منطقة المدينة المنورة" },
  { id: "QASSIM", label: "منطقة القصيم" },
  { id: "EASTERN", label: "المنطقة الشرقية" },
  { id: "ASIR", label: "منطقة عسير" },
  { id: "TABUK", label: "منطقة تبوك" },
  { id: "HAIL", label: "منطقة حائل" },
  { id: "NORTHERN", label: "منطقة الحدود الشمالية" },
  { id: "JAZAN", label: "منطقة جازان" },
  { id: "NAJRAN", label: "منطقة نجران" },
  { id: "BAHA", label: "منطقة الباحة" },
  { id: "JOUF", label: "منطقة الجوف" },
  { id: "BAHRAIN", label: "مملكة البحرين" },
] as const;

export type RegionId = (typeof REGIONS)[number]["id"];
export const REGION_IDS = REGIONS.map((r) => r.id) as [RegionId, ...RegionId[]];
export const regionLabel = (id: string | null | undefined) =>
  REGIONS.find((r) => r.id === id)?.label ?? "";

export type PickBranch = { id: string; name: string; city: string; region: string | null };

/** Regions that have at least one of the given branches, in the official order. */
export function regionsWith(branches: PickBranch[]) {
  return REGIONS.filter((r) => branches.some((b) => b.region === r.id));
}

/** Cities with branches in a region, alphabetically. */
export function citiesIn(branches: PickBranch[], region: string) {
  return [...new Set(branches.filter((b) => b.region === region).map((b) => b.city.trim()))].sort(
    (a, b) => a.localeCompare(b, "ar"),
  );
}

export function branchesIn(branches: PickBranch[], region: string, city: string) {
  return branches.filter((b) => b.region === region && b.city.trim() === city);
}
