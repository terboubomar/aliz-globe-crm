/* Order-source helpers for the customer (QR) complaint form. */

export type PlatformKind = "brand-app" | "branch" | "phone" | "other" | "app";

/** What kind of order source a platform name is, for its tile and the order-number hint. */
export function platformKind(label: string, brand: string): PlatformKind {
  const l = label.trim();
  if (l === "أخرى") return "other";
  if (/الفرع|حضوري|مباشر/.test(l)) return "branch";
  if (/هاتف|اتصال|جوال/.test(l)) return "phone";
  const brandWords = brand.split(/\s+/).filter((w) => w.length > 2);
  if (/تطبيق العلامة/.test(l) || (/تطبيق/.test(l) && brandWords.some((w) => l.includes(w))))
    return "brand-app";
  return "app";
}

/** A short line under the order-number box, for the chosen source. */
export function orderHint(label: string, kind: PlatformKind | null) {
  switch (kind) {
    case "branch":
      return "رقم الفاتورة أو الإيصال، إن وُجد.";
    case "phone":
      return "إن ذكره لك الموظف عند الطلب.";
    case "brand-app":
    case "app":
      return `تجده في ${label} ← طلباتي.`;
    default:
      return "تجده في تطبيق التوصيل أو على الفاتورة.";
  }
}

/** Logo files in /platforms for the order sources we know, by Arabic or English name. */
const PLATFORM_LOGOS: [RegExp, string][] = [
  [/هنقر|hunger/i, "hungerstation"],
  [/كيتا|keeta/i, "keeta"],
  [/جاهز|jahez/i, "jahez"],
  [/لوكيت|locate/i, "locate"],
  [/نينجا|ninja/i, "ninja"],
  [/مرسول|mrsool/i, "mrsool"],
  [/شفز|chefz/i, "thechefz"],
  [/تويو|to\s?you/i, "toyou"],
  [/كوينز|koinz/i, "koinz"],
  [/طلبات|talabat/i, "talabat"],
  [/أهلا|اهلا|ahlan/i, "ahlan"],
  [/تطبيق واقف|waqf/i, "waqf-app"],
];

/** The logo path for an order source, or undefined to show its icon or first letter. */
export function platformLogo(label: string) {
  const hit = PLATFORM_LOGOS.find(([re]) => re.test(label));
  return hit ? `/platforms/${hit[1]}.webp` : undefined;
}
