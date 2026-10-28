import { useState } from "react";
import { Download, Copy } from "lucide-react";
import { ComplaintReceipt, receiptText, receiptTime } from "./complaint-receipt";
export const confirmationLabels: Record<string, string> = {
  QUEUED: "تأكيد واتساب قيد الإرسال",
  ACCEPTED: "تم قبول رسالة التأكيد لدى واتساب",
  SENT: "تم إرسال التأكيد عبر واتساب",
  DELIVERED: "وصل التأكيد عبر واتساب",
  READ: "تمت قراءة التأكيد",
  FAILED: "تعذر إرسال تأكيد واتساب",
  UNKNOWN: "لم يتأكد إرسال رسالة واتساب",
  EXPIRED: "انتهت مهلة إرسال التأكيد",
  NOT_CONFIGURED: "تأكيد واتساب غير متاح حالياً",
  RATE_LIMITED: "لم يُرسل تأكيد إضافي لهذا الرقم",
};
export function ReceiptDetails({ receipt }: { receipt: ComplaintReceipt }) {
  const [feedback, setFeedback] = useState("");
  const items = [
    ["العلامة", receipt.brand],
    ["الفرع", receipt.branch],
    ["وقت الاستقبال — الرياض", receiptTime(receipt.receivedAt)],
    ["سبب الشكوى", receipt.category],
    ["العميل", receipt.customerName],
    ["رقم الطلب", receipt.externalOrder],
    ["منصة الطلب", receipt.platform],
    ["المصدر", receipt.source],
  ].filter(([, value]) => value);
  return (
    <section className="customer-receipt">
      <h2>تفاصيل الشكوى</h2>
      <dl>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="receipt-description">
        <h3>تفاصيل المشكلة</h3>
        <p>{receipt.description}</p>
      </div>
      <div className="receipt-actions">
        <button
          className="secondary"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([receiptText(receipt, window.location.origin)], {
                type: "text/plain;charset=utf-8",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = receipt.number + ".txt";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={16} />
          حفظ التأكيد
        </button>
        <button
          className="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(receiptText(receipt, window.location.origin));
              setFeedback("تم نسخ تفاصيل الشكوى.");
            } catch {
              setFeedback("تعذر النسخ. يمكنك حفظ التأكيد.");
            }
          }}
        >
          <Copy size={16} />
          نسخ التفاصيل
        </button>
      </div>
      {feedback && (
        <p role="status" className="hint">
          {feedback}
        </p>
      )}
    </section>
  );
}
