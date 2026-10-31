/*
 * What a new refund request needs: one of three order platforms, an amount, and
 * where the money goes back to (the customer's bank account or wallet).
 * The destination is stored encrypted next to the refund (outbox key
 * "refunddest:<refundId>"), never in Telegram messages beyond a masked hint.
 */

export const REFUND_PLATFORMS = ["تطبيق واقف", "طلب هاتف", "الفرع مباشرة"] as const;

export type RefundDestination =
  { method: "BANK"; holder: string; iban: string } | { method: "WALLET"; phone: string };

export const destinationMethods: Record<RefundDestination["method"], string> = {
  BANK: "الحساب البنكي للعميل",
  WALLET: "محفظة العميل",
};

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
    ? `${destinationMethods.BANK} (ينتهي بـ ${d.iban.slice(-4)})`
    : `${destinationMethods.WALLET} (جوال ينتهي بـ ${d.phone.slice(-4)})`;
