import { DEFAULT_CATEGORIES, DEFAULT_PLATFORMS, type Catalog } from "@/lib/catalog";

/**
 * Complaint reason labels by id, for showing any complaint (old reasons included).
 * Filled from the team's lists when the workspace loads (see applyCatalog).
 */
export const categories: Record<string, string> = Object.fromEntries(
  DEFAULT_CATEGORIES.map((c) => [c.id, c.label]),
);
/** The team's current lists; forms offer only the active entries. */
export const lists: Catalog = {
  categories: [...DEFAULT_CATEGORIES],
  platforms: [...DEFAULT_PLATFORMS],
};
export function applyCatalog(c: Catalog | undefined) {
  if (!c) return;
  lists.categories = c.categories;
  lists.platforms = c.platforms;
  for (const x of c.categories) categories[x.id] = x.label;
}
export const activeCategories = () => lists.categories.filter((c) => c.active);
export const activePlatforms = () => lists.platforms.filter((p) => p.active).map((p) => p.label);
