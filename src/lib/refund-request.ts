/*
 * What a new refund request needs: one of three order platforms, an amount, and
 * where the money goes back to. Every platform offers two ways, in its own order:
 *   - phone and in-branch orders: the customer's wallet in the Waqf App, or a bank
 *     transfer to the customer's account (holder + IBAN);
 *   - Waqf App orders: a bank transfer made from the Waqf App dashboard (found by
 *     the order number, or the customer's mobile; no IBAN), or the wallet.
 * The destination is stored encrypted next to the refund (outbox key
 * "refunddest:<refundId>"), never in Telegram messages beyond a masked hint.
 */

export const APP_PLATFORM = "تطبيق واقف";
export const REFUND_PLATFORMS = [APP_PLATFORM, "طلب هاتف", "الفرع مباشرة"] as const;

export type RefundDestination =
  | { method: "BANK"; holder: string; iban: string; bank?: string | undefined }
  | { method: "WALLET"; phone: string }
  // Waqf App orders: refunded from the app dashboard by order number (phone optional).
  | { method: "APP_BANK"; phone?: string | undefined };

export const destinationMethods: Record<RefundDestination["method"], string> = {
  BANK: "تحويل بنكي لحساب العميل",
  WALLET: "محفظة العميل في تطبيق واقف",
  APP_BANK: "تحويل بنكي عبر لوحة تحكم تطبيق واقف",
};

/** The ways a refund for this platform can be made, the usual one first. */
export const methodsForPlatform = (platform: string): RefundDestination["method"][] =>
  platform === APP_PLATFORM ? ["APP_BANK", "WALLET"] : ["WALLET", "BANK"];

export const methodLabel = (method: RefundDestination["method"], _platform?: string) =>
  destinationMethods[method];

export const normalizeIban = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

/** Saudi IBAN: SA + 22 digits, with a valid ISO 13616 check (mod 97). */
export function validIban(raw: string) {
  const iban = normalizeIban(raw);
  if (!/^SA\d{22}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

export const maskIban = (iban: string) => `SA•• •••• •••• ${iban.slice(-4)}`;
export const maskPhone = (phone: string) => `•••••${phone.slice(-4)}`;

/** One line for a person who must not see the full details (e.g. Telegram). */
export const destinationHint = (d: RefundDestination) =>
  d.method === "BANK"
    ? `${destinationMethods.BANK}${d.bank ? ` — ${d.bank}` : ""} (ينتهي بـ ${d.iban.slice(-4)})`
    : d.method === "APP_BANK"
      ? `${destinationMethods.APP_BANK} (برقم الطلب)`
      : `${destinationMethods.WALLET} (جوال ينتهي بـ ${d.phone.slice(-4)})`;

/**
 * Banks in Saudi Arabia, with the two-digit bank code inside a Saudi IBAN
 * (SAkk BB…) where known, so the bank can be picked from the IBAN.
 */
export const SAUDI_BANKS: { name: string; code?: string }[] = [
  { name: "البنك الأهلي السعودي", code: "10" },
  { name: "مصرف الراجحي", code: "80" },
  { name: "بنك الرياض", code: "20" },
  { name: "البنك السعودي الأول (ساب)", code: "45" },
  { name: "البنك السعودي الفرنسي", code: "55" },
  { name: "البنك العربي الوطني", code: "30" },
  { name: "مصرف الإنماء", code: "05" },
  { name: "بنك البلاد", code: "15" },
  { name: "بنك الجزيرة", code: "60" },
  { name: "البنك السعودي للاستثمار", code: "65" },
  { name: "بنك الخليج الدولي (ميم)", code: "90" },
  { name: "بنك إس تي سي (STC Bank)" },
  { name: "بنك دال 360 (D360)" },
  { name: "بنك فيجن (Vision Bank)" },
  { name: "بنك آخر" },
];

/** The bank a Saudi IBAN belongs to, from its bank code; undefined when unknown. */
export function bankFromIban(raw: string) {
  const iban = normalizeIban(raw);
  if (!/^SA\d{4}/.test(iban)) return undefined;
  const code = iban.slice(4, 6);
  return SAUDI_BANKS.find((b) => b.code === code)?.name;
}
