import { useEffect, useState } from "react";
import { Mail, MessageCircle, RefreshCw } from "lucide-react";
import { api, n } from "./types";
type Status = {
  enabled: boolean;
  ready: boolean;
  missing: string[];
  statuses: Record<string, number>;
};
export function WhatsAppIntegration() {
  return <ReceiptChannel channel="whatsapp" />;
}
export function EmailIntegration() {
  return <ReceiptChannel channel="email" />;
}
function ReceiptChannel({ channel }: { channel: "whatsapp" | "email" }) {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api<Status>("integrations/" + channel)
      .then((s) => {
        setStatus(s);
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [channel]);
  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      await api("settings/receipts/" + channel, { enabled });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  const labels: Record<string, string> = {
    WHATSAPP_ACCESS_TOKEN: "رمز الوصول الآمن",
    WHATSAPP_PHONE_NUMBER_ID: "رقم حساب المرسل",
    WHATSAPP_APP_SECRET: "مفتاح التحقق من الرسائل",
    WHATSAPP_VERIFY_TOKEN: "رمز ربط إشعارات التسليم",
    WHATSAPP_TEMPLATE_NAME: "اسم قالب تأكيد الشكوى",
    PUBLIC_HTTPS_APP_ORIGIN: "رابط CRM عام وآمن",
    WHATSAPP_TEMPLATE_APPROVED: "اعتماد قالب الرسالة",
    VALID_PHONE_NUMBER_ID: "معرّف صحيح لرقم واتساب",
    VALID_TEMPLATE_NAME: "اسم قالب صالح",
    VALID_API_VERSION: "إصدار صالح للاتصال",
    LOVABLE_API_KEY: "مفتاح خدمة البريد في Lovable",
    EMAIL_SENDER_DOMAIN: "نطاق المرسل الموثّق",
  };
  const email = channel === "email";
  return (
    <section className="panel whatsapp-integration">
      <div className="panel-head">
        <h2>
          {email ? <Mail size={19} /> : <MessageCircle size={19} />}
          {email ? "تأكيد الشكاوى بالبريد الإلكتروني" : "تأكيد الشكاوى عبر واتساب"}
        </h2>
        <button className="text-btn" onClick={() => void load()}>
          <RefreshCw size={15} />
          تحديث
        </button>
      </div>
      <div className="padded">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <>
            <span className={"badge " + (status.ready ? "green" : "neutral")}>
              {status.ready ? "جاهز للإرسال" : "غير متصل"}
            </span>
            <div className="whatsapp-counts">
              {[
                [
                  "في الانتظار",
                  (status.statuses["QUEUED"] ?? 0) + (status.statuses["SENDING"] ?? 0),
                ],
                [
                  email ? "أُرسلت" : "مقبولة لدى واتساب",
                  (status.statuses["ACCEPTED"] ?? 0) + (status.statuses["SENT"] ?? 0),
                ],
                [
                  "تم التسليم",
                  (status.statuses["DELIVERED"] ?? 0) + (status.statuses["READ"] ?? 0),
                ],
                [
                  "تحتاج مراجعة",
                  (status.statuses["FAILED"] ?? 0) +
                    (status.statuses["UNKNOWN"] ?? 0) +
                    (status.statuses["EXPIRED"] ?? 0),
                ],
              ].map(([label, count]) => (
                <span key={label}>
                  <b>{n(Number(count))}</b>
                  {label}
                </span>
              ))}
            </div>
            <p className="hint">
              يُرسل للعميل تأكيد واحد لكل شكوى، فقط إذا وافق على ذلك في النموذج.
            </p>
            {status.enabled ? (
              <button className="secondary" disabled={busy} onClick={() => void toggle(false)}>
                إيقاف الإرسال
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || status.missing.length > 0}
                onClick={() => void toggle(true)}
              >
                تفعيل الإرسال
              </button>
            )}
            {!status.ready && (
              <details>
                <summary>متطلبات الربط</summary>
                <ul>
                  {!status.enabled && <li>تفعيل إرسال التأكيدات</li>}
                  {status.missing.map((key) => (
                    <li key={key}>{labels[key] ?? key}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
