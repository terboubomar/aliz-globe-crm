import { useEffect, useState } from "react";
import { CheckCircle2, Mail, MessageCircle, RefreshCw, Send } from "lucide-react";
import {
  whatsappCheckDelivery,
  whatsappConfirmTest,
  whatsappDiagnose,
  whatsappSendTest,
  whatsappStatus,
} from "@/functions/whatsapp.functions";
import { api, n } from "./types";
import { Field } from "./ui";
type Status = {
  enabled: boolean;
  ready: boolean;
  missing: string[];
  statuses: Record<string, number>;
  provider?: string;
};
export function WhatsAppIntegration() {
  const [revision, setRevision] = useState(0);
  return (
    <>
      <ReceiptChannel channel="whatsapp" revision={revision} />
      <BevatelTest onChange={() => setRevision((v) => v + 1)} />
    </>
  );
}
export function EmailIntegration() {
  return <ReceiptChannel channel="email" />;
}
function ReceiptChannel({
  channel,
  revision = 0,
}: {
  channel: "whatsapp" | "email";
  revision?: number;
}) {
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
  }, [channel, revision]);
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
    BEVATEL_API_TOKEN: "رمز الوصول من Bevatel (BEVATEL_API_TOKEN)",
    BEVATEL_BASE_URL: "رابط Bevatel (BEVATEL_BASE_URL)",
    BEVATEL_ACCOUNT_ID: "رقم الحساب في Bevatel (BEVATEL_ACCOUNT_ID)",
    BEVATEL_INBOX_ID: "رقم صندوق واتساب في Bevatel (BEVATEL_INBOX_ID)",
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
            {!email && status.provider === "bevatel" && (
              <span className="badge blue">عبر Bevatel</span>
            )}
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
              {email
                ? "يُرسل للعميل تأكيد واحد لكل شكوى، فقط إذا وافق على ذلك في النموذج."
                : "فقط للعملاء الذين اختاروا واتساب في النموذج: تفاصيل الشكوى ورابط المتابعة عند الاستلام، ثم رسالة عند الحل وأخرى عند الإغلاق."}
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

/* ---------------- Bevatel: test send before automatic sending ---------------- */
type Template = "received" | "resolved" | "closed";
const templateLabels: Record<Template, string> = {
  received: "استلام الشكوى",
  resolved: "تمت المعالجة",
  closed: "إغلاق الشكوى",
};
const statusLabels: Record<string, [string, string]> = {
  sent: ["أُرسلت", "green"],
  failed: ["فشلت", "red"],
  skipped: ["لم تُرسل", "neutral"],
};
type WaStatus = Awaited<ReturnType<typeof whatsappStatus>>;
type Delivery = Awaited<ReturnType<typeof whatsappCheckDelivery>>;
type Format = "bevatel" | "flat" | "body" | "text";
const deliveryLabels: Record<string, [string, string]> = {
  queued: ["لم تخرج من Bevatel إلى واتساب بعد (انتظر دقيقة وأعد التحقق)", "amber"],
  sent: ["خرجت إلى واتساب، بانتظار تأكيد الوصول", "amber"],
  delivered: ["وصلت إلى الجوال", "green"],
  read: ["وصلت وقُرئت", "green"],
  failed: ["رفضها واتساب", "red"],
};
type TestResult = Awaited<ReturnType<typeof whatsappSendTest>>;

export const errorText = (e: unknown, fallback = "تعذر الاتصال") => {
  const m = (e as Error)?.message ?? "";
  try {
    const list = JSON.parse(m) as { message?: string }[];
    if (Array.isArray(list) && list[0]?.message) return list[0].message;
  } catch {
    /* plain message */
  }
  return m || fallback;
};
export const when = (iso: string) =>
  new Date(iso).toLocaleString("ar-SA-u-nu-latn", {
    timeZone: "Asia/Riyadh",
    dateStyle: "short",
    timeStyle: "short",
  });

function BevatelTest({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<WaStatus | null>(null),
    [phone, setPhone] = useState(""),
    [template, setTemplate] = useState<Template>("received"),
    [format, setFormat] = useState<Format | null>(null),
    [sentAs, setSentAs] = useState<Format>("bevatel"),
    [result, setResult] = useState<TestResult | null>(null),
    [delivery, setDelivery] = useState<{ id: string; d: Delivery } | null>(null),
    [report, setReport] = useState<{ id: string; text: string } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    whatsappStatus()
      .then(setStatus)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);
  if (status && !status.configured) return null;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setDelivery(null);
      const chosen: Format = format ?? status?.format ?? "bevatel";
      setSentAs(chosen);
      setResult(
        await whatsappSendTest({
          data: { phone, template, format: chosen },
        }),
      );
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
    void load();
  }
  async function check(id: string) {
    setBusy(true);
    setError("");
    try {
      setDelivery({ id, d: await whatsappCheckDelivery({ data: { id } }) });
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }
  async function diagnose(id: string) {
    setBusy(true);
    setError("");
    try {
      setReport({ id, text: (await whatsappDiagnose({ data: { id } })).report });
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }
  const deliveryView = (id: string) =>
    delivery?.id === id && (
      <div className="bevatel-delivery">
        <span className={"badge " + (deliveryLabels[delivery.d.status]?.[1] ?? "neutral")}>
          {deliveryLabels[delivery.d.status]?.[0] ?? "الحالة: " + delivery.d.status}
        </span>
        {delivery.d.error && <span className="bevatel-error">{delivery.d.error}</span>}
        {delivery.d.raw && (
          <details>
            <summary>تفاصيل الحالة من Bevatel</summary>
            <pre dir="ltr">{delivery.d.raw}</pre>
          </details>
        )}
      </div>
    );
  const reportView = (id: string) =>
    report?.id === id && (
      <details className="bevatel-delivery" open>
        <summary>تقرير التشخيص (أرسل لقطة منه للدعم الفني)</summary>
        <pre dir="ltr">{report.text}</pre>
      </details>
    );
  async function confirm() {
    if (!result?.id) return;
    setBusy(true);
    try {
      await whatsappConfirmTest({ data: { id: result.id } });
      setResult(null);
      await load();
      onChange();
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  return (
    <section className="panel whatsapp-integration bevatel-test">
      <div className="panel-head">
        <h2>
          <Send size={18} /> رسالة تجريبية عبر Bevatel
        </h2>
        {status?.testConfirmed ? (
          <span className="badge green">
            <CheckCircle2 size={13} /> تم تأكيد وصول رسالة تجريبية
          </span>
        ) : (
          <span className="badge amber">لم يُؤكَّد وصول رسالة تجريبية</span>
        )}
      </div>
      <div className="padded">
        <p className="hint">
          أرسل أحد القوالب الثلاثة إلى جوالك ببيانات تجريبية (AG-2026-000123، برجر واقف…). لا يمكن
          تفعيل الإرسال التلقائي للعملاء قبل أن تصلك رسالة وتؤكد وصولها هنا. إن لم تصل بصيغة Bevatel
          جرّب صيغة أخرى؛ الصيغة التي تؤكد وصولها تُستخدم للعملاء.
        </p>
        <form className="bevatel-test-form" onSubmit={(e) => void send(e)}>
          <Field label="رقم الجوال">
            <input
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder="05XXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </Field>
          <Field label="القالب">
            <select value={template} onChange={(e) => setTemplate(e.target.value as Template)}>
              {(Object.keys(templateLabels) as Template[]).map((t) => (
                <option key={t} value={t}>
                  {templateLabels[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="صيغة القالب">
            <select
              value={format ?? status?.format ?? "bevatel"}
              onChange={(e) => setFormat(e.target.value as Format)}
            >
              <option value="bevatel">صيغة Bevatel (موصى بها)</option>
              <option value="flat">الصيغة 1</option>
              <option value="body">الصيغة 2</option>
              <option value="text">نص عادي (بلا قالب)</option>
            </select>
          </Field>
          <button className="primary" disabled={busy || phone.trim().length < 9}>
            <Send size={15} /> {busy ? "جارٍ الإرسال…" : "إرسال تجريبي"}
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <div className="bevatel-result" role="status">
            <div className="bevatel-result-head">
              <span className={"badge " + (statusLabels[result.status]?.[1] ?? "neutral")}>
                {statusLabels[result.status]?.[0] ?? result.status}
              </span>
              {result.error && <span className="bevatel-error">{result.error}</span>}
            </div>
            {result.response && (
              <details open>
                <summary>رد Bevatel كما وصل</summary>
                <pre dir="ltr">{result.response}</pre>
              </details>
            )}
            {result.status === "sent" && result.id && sentAs === "text" && (
              <p className="hint">
                رسالة نصية للفحص فقط: تصل فقط إذا راسلت رقم الشركة خلال آخر 24 ساعة، ولا يمكن
                اعتمادها للعملاء.
              </p>
            )}
            {result.status === "sent" && result.id && (
              <>
                <div className="bevatel-confirm">
                  <span>
                    قبلت Bevatel الرسالة. انتظر دقيقة ثم تحقق: هل وصلت فعلاً إلى واتساب على جوالك؟
                  </span>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void check(result.id!)}
                  >
                    <RefreshCw size={15} /> تحقق من حالة التسليم
                  </button>
                  <button
                    className="primary"
                    disabled={busy || sentAs === "text"}
                    onClick={() => void confirm()}
                  >
                    <CheckCircle2 size={15} /> نعم، وصلتني الرسالة
                  </button>
                </div>
                {deliveryView(result.id)}
                <button
                  className="text-btn"
                  disabled={busy}
                  onClick={() => void diagnose(result.id!)}
                >
                  تشخيص الربط
                </button>
                {reportView(result.id)}
              </>
            )}
          </div>
        )}
        {!!status?.recent.length && (
          <details className="bevatel-recent">
            <summary>آخر محاولات الإرسال ({n(status.recent.length)})</summary>
            <ul>
              {status.recent.map((r) => (
                <li key={r.id}>
                  <span className={"badge " + (statusLabels[r.status]?.[1] ?? "neutral")}>
                    {statusLabels[r.status]?.[0] ?? r.status}
                  </span>
                  <b>{templateLabels[r.template]}</b>
                  {r.is_test && <small>تجريبية</small>}
                  {r.manual && <small>إعادة إرسال</small>}
                  {r.phone_masked && <bdi dir="ltr">{r.phone_masked}</bdi>}
                  <time>{when(r.created_at)}</time>
                  {r.error && <small className="bevatel-error">{r.error}</small>}
                  {r.status === "sent" && (
                    <button className="text-btn" disabled={busy} onClick={() => void check(r.id)}>
                      تحقق من التسليم
                    </button>
                  )}
                  {r.is_test && r.status === "sent" && (
                    <button
                      className="text-btn"
                      disabled={busy}
                      onClick={() => void diagnose(r.id)}
                    >
                      تشخيص
                    </button>
                  )}
                  {deliveryView(r.id)}
                  {reportView(r.id)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
