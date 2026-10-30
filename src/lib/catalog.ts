/*
 * Lists the team manages in Settings → Lists:
 * - complaint reasons (سبب الشكوى): saved on each complaint by id; a reason is
 *   switched off rather than deleted, so older complaints keep their label.
 *   "Urgent" reasons always make the complaint P1 (like food safety).
 * - order platforms (منصة الطلب): saved on the complaint as the platform name.
 * Stored in app_settings under "complaint_categories" and "order_platforms".
 */

export type CategoryItem = {
  id: string;
  label: string;
  active: boolean;
  urgent: boolean;
  group: string; // heading in the complaint form; "" = no group
};
export type PlatformItem = { label: string; active: boolean };
export type Catalog = { categories: CategoryItem[]; platforms: PlatformItem[] };

export const DEFAULT_CATEGORIES: CategoryItem[] = [
  { id: "DELAY", label: "تأخر الطلب", active: true, urgent: false, group: "مشكلة في الطلب" },
  { id: "MISSING", label: "طلب ناقص", active: true, urgent: false, group: "مشكلة في الطلب" },
  {
    id: "WRONG_BRANCH",
    label: "طلب في فرع آخر",
    active: true,
    urgent: false,
    group: "مشكلة في الطلب",
  },
  { id: "QUALITY", label: "جودة الطعام", active: true, urgent: false, group: "جودة الطعام" },
  { id: "SAFETY", label: "سلامة الغذاء", active: true, urgent: true, group: "صحة وسلامة" },
  { id: "SERVICE", label: "تجربة الخدمة", active: true, urgent: false, group: "الخدمة والموظفين" },
  { id: "OTHER", label: "أخرى", active: true, urgent: false, group: "" },
];

/** "Other": the person picking it is asked to say what the problem is. */
export const asksDetail = (c: { id: string; label: string }) =>
  c.id === "OTHER" || c.label.trim() === "أخرى";

/** The first reason the form shows (groups first), so it starts selected. */
export const firstReason = <T extends { id: string; group?: string | undefined }>(list: T[]) =>
  grouped(list)[0]?.items[0];

/** Suggested reasons for a restaurant group, offered in Settings → Lists. */
export const SUGGESTED_CATEGORIES: { label: string; group: string; urgent?: boolean }[] = [
  { label: "طلب خاطئ", group: "مشكلة في الطلب" },
  { label: "عدم الالتزام بملاحظات الطلب", group: "مشكلة في الطلب" },
  { label: "الطلب لم يصل", group: "مشكلة في الطلب" },
  { label: "إلغاء الطلب دون إبلاغ العميل", group: "مشكلة في الطلب" },
  { label: "تغليف سيء أو انسكاب", group: "مشكلة في الطلب" },
  { label: "الطعام بارد", group: "جودة الطعام" },
  { label: "طعام غير مطهو جيداً", group: "جودة الطعام", urgent: true },
  { label: "طعم أو رائحة غير طبيعية", group: "جودة الطعام", urgent: true },
  { label: "جسم غريب في الطعام", group: "جودة الطعام", urgent: true },
  { label: "الكمية أقل من المعتاد", group: "جودة الطعام" },
  { label: "تسمم غذائي أو أعراض بعد الأكل", group: "صحة وسلامة", urgent: true },
  { label: "حساسية غذائية", group: "صحة وسلامة", urgent: true },
  { label: "نظافة الفرع أو العاملين", group: "صحة وسلامة" },
  { label: "خطأ في الفاتورة أو السعر", group: "السعر والدفع" },
  { label: "خصم أو عرض لم يُطبّق", group: "السعر والدفع" },
  { label: "مبلغ مخصوم مرتين", group: "السعر والدفع" },
  { label: "سوء تعامل الموظف", group: "الخدمة والموظفين" },
  { label: "انتظار طويل في الفرع", group: "الخدمة والموظفين" },
  { label: "الفرع مغلق في وقت العمل", group: "الخدمة والموظفين" },
  { label: "سلوك المندوب", group: "التوصيل" },
  { label: "المندوب لم يجد العنوان", group: "التوصيل" },
  { label: "مشكلة في التطبيق أو الطلب الإلكتروني", group: "التطبيق والموقع" },
];

/**
 * Reasons under their group headings, for the form's dropdown. Groups appear in
 * the order of their first reason; reasons keep the team's order inside a group;
 * reasons without a group come last.
 */
export function grouped<T extends { group?: string | undefined }>(items: T[]) {
  const groups: { group: string; items: T[] }[] = [];
  for (const item of items) {
    const g = (item.group ?? "").trim();
    const hit = groups.find((x) => x.group === g);
    if (hit) hit.items.push(item);
    else groups.push({ group: g, items: [item] });
  }
  return [...groups.filter((g) => g.group), ...groups.filter((g) => !g.group)];
}
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
          // Lists saved before groups existed: built-in reasons get their usual group.
          group:
            c.group === undefined
              ? (DEFAULT_CATEGORIES.find((d) => d.id === c.id)?.group ?? "")
              : clean(c.group, 40),
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
