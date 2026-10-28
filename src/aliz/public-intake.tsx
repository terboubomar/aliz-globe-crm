import type { ComplaintReceipt } from "./complaint-receipt";
import { ReceiptDetails, confirmationLabels, emailConfirmationLabels } from "./receipt-details";
import { useState, useEffect, FormEvent } from "react";
import { ArrowLeft, CheckCircle2, ShieldCheck, Upload } from "lucide-react";
import { api, categories } from "./types";
import { Field, Submit } from "./ui";
export default function PublicIntake({ code }: { code: string }) {
  const [requestKey] = useState(() => crypto.randomUUID());
  const [context, setContext] = useState<{
      brand: string;
      branch: string;
      logo: string;
      demo: boolean;
      whatsappAvailable: boolean;
      emailAvailable?: boolean;
    } | null>(null),
    [whatsappConsent, setWhatsAppConsent] = useState(false),
    [emailConsent, setEmailConsent] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState<{
      id: string;
      number: string;
      trackingToken: string;
      receipt?: ComplaintReceipt;
      confirmationStatus?: string;
      emailStatus?: string;
    } | null>(null),
    [files, setFiles] = useState<File[]>([]),
    [uploadError, setUploadError] = useState("");
  useEffect(() => {
    api<typeof context>("public/q/" + code)
      .then(setContext)
      .catch((e) => setError(e.message));
  }, [code]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const b = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      const result = await api<{
        id: string;
        number: string;
        trackingToken: string;
        receipt?: ComplaintReceipt;
        confirmationStatus?: string;
        emailStatus?: string;
      }>(
        "public/q/" + code,
        {
          ...b,
          consent: b["consent"] === "on",
          whatsappConsent: !!context?.whatsappAvailable && whatsappConsent,
          emailConsent: !!context?.emailAvailable && emailConsent,
        },
        { headers: { "Idempotency-Key": requestKey } },
      );
      setReceipt(result);
      await attach(result);
      (e.target as HTMLFormElement).reset();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  async function attach(result: NonNullable<typeof receipt>) {
    if (!files.length) return;
    const body = new FormData();
    files.forEach((f) => body.append("files", f));
    try {
      await api("public/attachments/" + result.id, undefined, {
        method: "POST",
        headers: { "x-case-token": result.trackingToken },
        body,
      });
      setUploadError("");
      setFiles([]);
    } catch (e) {
      setUploadError("تم حفظ البلاغ، لكن تعذر رفع الصور: " + (e as Error).message);
    }
  }
  return (
    <main className="public-shell">
      <div className="public-top">
        <img src="/logos/aliz.webp" alt="أليز غلوب" />
        <span>نهتم بتجربتك</span>
      </div>
      <section className="public-card">
        {!context ? (
          <div className="padded">
            <h1>{error ? "الرابط غير متاح" : "جارٍ تحميل بيانات الفرع…"}</h1>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : receipt ? (
          <div className="public-success">
            <CheckCircle2 size={54} />
            <h1>تم استلام بلاغك</h1>

            <div className="receipt-number" dir="ltr">
              {receipt.number}
            </div>
            <a className="primary" href={"/track/" + receipt.trackingToken}>
              متابعة حالة البلاغ <ArrowLeft size={17} />
            </a>
            {receipt.confirmationStatus && confirmationLabels[receipt.confirmationStatus] && (
              <p role="status" className="notice">
                {confirmationLabels[receipt.confirmationStatus]}
              </p>
            )}
            {receipt.emailStatus && emailConfirmationLabels[receipt.emailStatus] && (
              <p role="status" className="notice">
                {emailConfirmationLabels[receipt.emailStatus]}
              </p>
            )}
            {receipt.receipt && <ReceiptDetails receipt={receipt.receipt} />}
            <p className="hint">
              احفظ رابط المتابعة في مكان آمن. الرابط خاص بك ويعرض تفاصيل شكواك وحالتها.
            </p>
            {uploadError && (
              <div role="alert">
                <p className="error">{uploadError}</p>
                <button className="secondary" onClick={() => attach(receipt)}>
                  إعادة رفع الصور
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="public-brand">
              <img src={"/logos/" + context.logo} alt={context.brand} />
              <BadgeText
                text={context.demo ? "فرع تجريبي • لا تدخل بيانات حقيقية" : context.branch}
              />
              <h1>كيف نقدر نساعدك؟</h1>
              <p>
                شاركنا تجربتك مع {context.brand} — {context.branch}
              </p>
            </div>
            {context.demo && (
              <div className="notice">نموذج تجريبي محلي. البيانات المُدخلة تُحفظ للتجربة فقط.</div>
            )}
            <form onSubmit={submit}>
              <div className="form-grid">
                <Field label="سبب البلاغ" full>
                  <select name="category" required>
                    {Object.entries(categories).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="شاركنا تفاصيل المشكلة" full>
                  <textarea
                    name="description"
                    minLength={10}
                    maxLength={4000}
                    rows={5}
                    required
                    placeholder="وش صار؟ وكيف نقدر نساعدك؟"
                  />
                </Field>
                <Field label="اسمك (اختياري)">
                  <input name="name" autoComplete="name" maxLength={100} />
                </Field>
                <Field label={whatsappConsent ? "جوال واتساب" : "جوالك للتواصل (اختياري)"}>
                  <input
                    name="phone"
                    required={whatsappConsent}
                    type="tel"
                    dir="ltr"
                    pattern="(\+?966|0)?5[0-9]{8}"
                    placeholder="05xxxxxxxx"
                    autoComplete="tel"
                  />
                </Field>
                <Field label="رقم الطلب (اختياري)">
                  <input name="externalOrder" dir="ltr" maxLength={100} />
                </Field>
                <Field label="منصة الطلب (اختياري)">
                  <input name="platform" maxLength={80} />
                </Field>
                {context.whatsappAvailable && (
                  <label className="checkbox full">
                    <input
                      type="checkbox"
                      checked={whatsappConsent}
                      onChange={(e) => setWhatsAppConsent(e.target.checked)}
                    />
                    أوافق على استلام تأكيد الشكوى وتفاصيلها عبر واتساب
                  </label>
                )}
                {context.emailAvailable && (
                  <>
                    <Field label={emailConsent ? "بريدك الإلكتروني" : "بريدك الإلكتروني (اختياري)"}>
                      <input
                        name="email"
                        type="email"
                        dir="ltr"
                        maxLength={200}
                        required={emailConsent}
                        placeholder="name@example.com"
                        autoComplete="email"
                      />
                    </Field>
                    <label className="checkbox full">
                      <input
                        type="checkbox"
                        checked={emailConsent}
                        onChange={(e) => setEmailConsent(e.target.checked)}
                      />
                      أوافق على استلام تأكيد الشكوى وتفاصيلها بالبريد الإلكتروني
                    </label>
                  </>
                )}
                <label className="public-upload full">
                  <Upload size={24} />
                  <b>أرفق صورة للطلب (اختياري)</b>
                  <small>حتى 3 صور • 5 ميغابايت لكل صورة • JPG، PNG، WebP</small>
                  <input
                    className="upload-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={(e) => {
                      const f = Array.from(e.target.files ?? []);
                      if (f.length > 3 || f.some((x) => x.size > 5 * 1024 * 1024)) {
                        setError("اختر حتى 3 صور، لا يزيد حجم كل منها عن 5 ميغابايت");
                        e.target.value = "";
                        setFiles([]);
                      } else {
                        setFiles(f);
                        setError("");
                      }
                    }}
                  />
                  {/* The browser's own picker text follows the phone's language, so the
                      native control is visually hidden and this Arabic button stands in. */}
                  <span className="upload-button" aria-hidden="true">
                    اختر الصور
                  </span>
                  <span className="upload-files" aria-live="polite">
                    {files.length ? files.map((f) => f.name).join("، ") : "لم تُختر صور بعد"}
                  </span>
                </label>
                <div className="public-privacy full">
                  <ShieldCheck size={19} />
                  <p>
                    نستخدم المعلومات التي تشاركها لمعالجة البلاغ والتواصل بشأنه. لا ترفق بيانات دفع
                    أو مستندات شخصية.{" "}
                    {context.demo ? "نص الخصوصية النهائي وسياسة الاحتفاظ بانتظار الاعتماد." : ""}
                  </p>
                </div>
                <label className="checkbox full">
                  <input name="consent" type="checkbox" required />
                  اطلعت على إشعار الخصوصية وأوافق على تسجيل البلاغ.
                </label>
              </div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <Submit busy={busy}>
                إرسال البلاغ <ArrowLeft size={18} />
              </Submit>
              <p className="hint">
                سيتم التواصل حسب المعلومات التي قدمتها. لا نضمن وقت معالجة أو استرجاع غير معتمد.
              </p>
            </form>
          </>
        )}
      </section>
      <div className="public-footer">
        <ShieldCheck size={15} /> متابعة آمنة • أليز غلوب
      </div>
    </main>
  );
}
function BadgeText({ text }: { text: string }) {
  return <span className="public-badge">{text}</span>;
}
