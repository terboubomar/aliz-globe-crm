/*
 * Ready-made replies the team picks when writing a note on a complaint
 * (comment, resolve, follow-up, escalate, ...). Managed in Settings → Templates
 * and stored in app_settings under "reply_templates".
 *
 * Placeholders are filled in the browser when a template is picked:
 *   {رقم_الشكوى} {العلامة} {الفرع} {اسمي}
 */

export type ReplyTemplate = {
  id: string;
  title: string;
  text: string;
  actions: string[]; // empty = every action with a note
  categories: string[]; // empty = every category
  brandIds: string[]; // empty = every brand
};

/** Actions whose form has a note box, with the label shown in Settings. */
export const TEMPLATE_ACTIONS: Record<string, string> = {
  comment: "إضافة ملاحظة",
  resolve: "توثيق الحل",
  followup: "نتيجة التواصل مع العميل",
  contact: "تسجيل تواصل",
  escalate: "التصعيد",
  assign: "الإسناد",
  close: "الإغلاق",
  reopen: "إعادة الفتح",
};

export const PLACEHOLDERS: Record<string, string> = {
  "{رقم_الشكوى}": "رقم الشكوى",
  "{العلامة}": "اسم العلامة",
  "{الفرع}": "اسم الفرع",
  "{اسمي}": "اسم الموظف الذي يكتب",
};

export const MANAGE_ROLES = ["SUPER_ADMIN", "CUSTOMER_SERVICE_MANAGER", "SHIFT_LEAD"];
export const MAX_TEMPLATES = 200;

/** Templates that fit this action, complaint category and brand, most specific first. */
export function matching(
  templates: ReplyTemplate[],
  at: { action: string; category: string; brandId: string },
) {
  const fits = (list: string[], v: string) => !list.length || list.includes(v);
  const score = (t: ReplyTemplate) =>
    Number(!!t.actions.length) + Number(!!t.categories.length) + Number(!!t.brandIds.length);
  return templates
    .filter(
      (t) =>
        fits(t.actions, at.action) &&
        fits(t.categories, at.category) &&
        fits(t.brandIds, at.brandId),
    )
    .sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title, "ar"));
}

export function fill(
  text: string,
  v: { number: string; brand: string; branch: string; me: string },
) {
  return text
    .replaceAll("{رقم_الشكوى}", v.number)
    .replaceAll("{العلامة}", v.brand)
    .replaceAll("{الفرع}", v.branch)
    .replaceAll("{اسمي}", v.me);
}

/** Starter set offered when no templates exist yet. */
export const STARTER_TEMPLATES: Omit<ReplyTemplate, "id">[] = [
  {
    title: "اعتذار عن التأخير",
    text: "تواصلنا مع العميل واعتذرنا عن تأخر الطلب، وتم إبلاغ فرع {الفرع} لمراجعة سبب التأخير.",
    actions: ["comment", "followup", "contact"],
    categories: [],
    brandIds: [],
  },
  {
    title: "تم التواصل ولم يرد العميل",
    text: "تمت محاولة الاتصال بالعميل ولم يرد. سنعيد المحاولة لاحقاً.",
    actions: ["followup", "contact", "comment"],
    categories: [],
    brandIds: [],
  },
  {
    title: "تم الحل بالتنسيق مع الفرع",
    text: "تم التنسيق مع فرع {الفرع} ومعالجة المشكلة، وسيتم التواصل مع العميل لتأكيد رضاه.",
    actions: ["resolve"],
    categories: [],
    brandIds: [],
  },
  {
    title: "تصعيد لعدم استجابة الفرع",
    text: "تم التواصل مع فرع {الفرع} دون استجابة، ونحتاج تدخل المشرف لمعالجة الشكوى {رقم_الشكوى}.",
    actions: ["escalate"],
    categories: [],
    brandIds: [],
  },
];
