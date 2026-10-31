/*
 * Wording of the Telegram bot's messages that a super admin can change in
 * Settings → Templates. Stored in app_settings under "telegram_templates";
 * an empty value means the default below. Text only: the icons, layout and
 * the complaint/shift details are added by the bot.
 */
export type WordKey =
  | "assigned"
  | "assignedUrgent"
  | "assignedNote"
  | "newComplaint"
  | "newUrgent"
  | "deadlineWarn"
  | "deadlineMissed"
  | "shiftReminder"
  | "shiftNote"
  | "weekNew"
  | "weekUpdated"
  | "welcome"
  | "refundNew";

export const WORDS: Record<
  WordKey,
  { label: string; default: string; hint?: string; optional?: boolean }
> = {
  assigned: { label: "عنوان إسناد شكوى للموظف", default: "تم إسناد شكوى إليك" },
  assignedUrgent: { label: "عنوان إسناد شكوى عاجلة P1", default: "شكوى عاجلة أُسندت إليك" },
  assignedNote: {
    label: "سطر إضافي تحت رسالة الإسناد",
    default: "",
    optional: true,
    hint: "مثال: يرجى الاستلام خلال 10 دقائق والتواصل مع العميل.",
  },
  newComplaint: { label: "عنوان شكوى جديدة (للمسؤول الأعلى)", default: "شكوى جديدة" },
  newUrgent: { label: "عنوان شكوى عاجلة جديدة (للمسؤول الأعلى)", default: "شكوى عاجلة جديدة (P1)" },
  deadlineWarn: {
    label: "تنبيه اقتراب المهلة",
    default: "اقتربت مهلة {المرحلة} لشكوى مسندة إليك",
    hint: "{المرحلة} = أول إجراء أو الاستلام أو الحل",
  },
  deadlineMissed: {
    label: "تنبيه تجاوز المهلة",
    default: "تجاوزت الشكوى مهلة {المرحلة}",
    hint: "{المرحلة} = أول إجراء أو الاستلام أو الحل",
  },
  shiftReminder: { label: "عنوان تذكير الوردية", default: "تذكير بورديتك اليوم" },
  shiftNote: {
    label: "سطر إضافي تحت تذكير الوردية",
    default: "",
    optional: true,
    hint: "مثال: تأكد من تسجيل الدخول قبل بداية الوردية بخمس دقائق.",
  },
  weekNew: { label: "عنوان إرسال جدول جديد", default: "جدول جديد" },
  weekUpdated: { label: "عنوان إرسال جدول معدّل", default: "تم تحديث جدولك" },
  welcome: { label: "رسالة الترحيب بعد ربط الحساب", default: "تم ربط حسابك بنظام شكاوى أليز" },
  refundNew: {
    label: "عنوان طلب استرجاع جديد (لمدير تقنية المعلومات)",
    default: "طلب استرجاع جديد",
  },
};

export const WORD_KEYS = Object.keys(WORDS) as WordKey[];
export const MAX_WORD_LENGTH = 300;

/** The text for a key: the saved wording, or the default when empty. */
export function word(
  saved: Partial<Record<string, unknown>>,
  key: WordKey,
  vars: Record<string, string> = {},
) {
  const raw = typeof saved[key] === "string" ? (saved[key] as string).trim() : "";
  let text = (raw || WORDS[key].default).slice(0, MAX_WORD_LENGTH);
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v);
  return text;
}
