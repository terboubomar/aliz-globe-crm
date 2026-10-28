export type ComplaintReceipt = {
  number: string;
  brand: string;
  branch: string;
  receivedAt: string;
  category: string;
  description: string;
  customerName: string;
  externalOrder: string;
  platform: string;
  source: string;
  trackingPath: string;
};
export const receiptTime = (value: string) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    calendar: "gregory",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Riyadh",
  }).format(new Date(value));
export function receiptText(r: ComplaintReceipt, origin = "") {
  return [
    "تم استلام شكواك",
    `رقم الشكوى: ${r.number}`,
    `العلامة: ${r.brand}`,
    `الفرع: ${r.branch}`,
    `وقت الاستقبال: ${receiptTime(r.receivedAt)} (الرياض)`,
    `التصنيف: ${r.category}`,
    r.customerName && `العميل: ${r.customerName}`,
    r.externalOrder && `رقم الطلب: ${r.externalOrder}`,
    r.platform && `منصة الطلب: ${r.platform}`,
    `المصدر: ${r.source}`,
    `التفاصيل: ${r.description}`,
    r.trackingPath && `متابعة الشكوى: ${origin}${r.trackingPath}`,
  ]
    .filter(Boolean)
    .join("\n");
}
