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
