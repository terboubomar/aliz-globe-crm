/*
 * Lists the team manages in Settings → Lists:
 * - complaint reasons (سبب الشكوى): saved on each complaint by id; a reason is
 *   switched off rather than deleted, so older complaints keep their label.
 *   "Urgent" reasons always make the complaint P1 (like food safety).
 * - order platforms (منصة الطلب): saved on the complaint as the platform name.
 * Stored in app_settings under "complaint_categories" and "order_platforms".
 */

export type CategoryItem = { id: string; label: string; active: boolean; urgent: boolean };
export type PlatformItem = { label: string; active: boolean };
export type Catalog = { categories: CategoryItem[]; platforms: PlatformItem[] };

export const DEFAULT_CATEGORIES: CategoryItem[] = [
  { id: "DELAY", label: "تأخر الطلب", active: true, urgent: false },
  { id: "MISSING", label: "طلب ناقص", active: true, urgent: false },
  { id: "WRONG_BRANCH", label: "طلب في فرع آخر", active: true, urgent: false },
  { id: "QUALITY", label: "جودة الطعام", active: true, urgent: false },
  { id: "SAFETY", label: "سلامة الغذاء", active: true, urgent: true },
  { id: "SERVICE", label: "تجربة الخدمة", active: true, urgent: false },
  { id: "OTHER", label: "أخرى", active: true, urgent: false },
];
export const DEFAULT_PLATFORMS: PlatformItem[] = [
  "هنقرستيشن",
  "جاهز",
  "كيتا",
  "مرسول",
  "ذا شفز",
  "تويو",
  "تطبيق العلامة",
  "الفرع مباشرة",
  "أخرى",
].map((label) => ({ label, active: true }));

export const CATALOG_ROLES = ["SUPER_ADMIN", "CUSTOMER_SERVICE_MANAGER"];
export const CATEGORY_ID = /^[A-Z][A-Z0-9_]{1,39}$/;
export const MAX_ITEMS = 100;

const clean = (s: unknown, max: number) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Saved lists, or the defaults; built-in reasons are always kept for older complaints. */
export function toCatalog(categories: unknown, platforms: unknown): Catalog {
  const saved = Array.isArray(categories)
    ? (categories as Partial<CategoryItem>[])
        .filter((c) => typeof c?.id === "string" && CATEGORY_ID.test(c.id) && clean(c.label, 60))
        .map((c) => ({
          id: c.id!,
          label: clean(c.label, 60),
          active: c.active !== false,
          urgent: c.urgent === true,
        }))
    : [];
  const cats = saved.length ? saved : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  for (const d of DEFAULT_CATEGORIES)
    if (!cats.some((c) => c.id === d.id)) cats.push({ ...d, active: false });
  const plats = Array.isArray(platforms)
    ? (platforms as Partial<PlatformItem>[])
        .filter((p) => clean(p?.label, 60))
        .map((p) => ({ label: clean(p.label, 60), active: p.active !== false }))
    : DEFAULT_PLATFORMS;
  return { categories: cats, platforms: plats };
}

export const categoryLabel = (c: Catalog, id: string) =>
  c.categories.find((x) => x.id === id)?.label ?? id;

/** A new id for a reason the team adds, e.g. "C_K3M9Q2". */
export function newCategoryId(taken: string[]) {
  for (;;) {
    const id = "C_" + Math.random().toString(36).slice(2, 8).toUpperCase();
    if (CATEGORY_ID.test(id) && !taken.includes(id)) return id;
  }
}
