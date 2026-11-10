import type { ComplaintReceipt } from "./complaint-receipt";
import { ReceiptDetails, confirmationLabels, emailConfirmationLabels } from "./receipt-details";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Lightbulb,
  Mail,
  MessageCircle,
  MessageSquareWarning,
  Phone,
  ShieldCheck,
  X,
} from "lucide-react";
import { SUGGESTION, asksDetail } from "@/lib/catalog";
import { api, activeCategories, activePlatforms } from "./types";
import { PlatformTiles, ReasonCards } from "./public-pickers";
import { HelpWidget } from "./public-help";
import { orderHint, platformKind } from "@/lib/public-form";
import { citiesIn, regionsWith, type PickBranch } from "@/lib/regions";

type Context = {
  brand: string;
  branch: string;
  logo: string;
  demo: boolean;
  whatsappAvailable: boolean;
  emailAvailable?: boolean;
  categories?: { id: string; label: string }[];
  platforms?: string[];
  /** Brand QR codes: the brand's active branches, to pick region → branch. */
  branches?: PickBranch[];
};
type Result = {
  id: string;
  number: string;
  trackingToken: string;
  receipt?: ComplaintReceipt;
  confirmationStatus?: string;
  emailStatus?: string;
};
type Contact = "whatsapp" | "call" | "email";
type Kind = "complaint" | "suggestion";

const COMPLAINT_STEPS = ["وش صار؟", "تفاصيل الطلب", "التواصل والإرسال"];
const SUGGESTION_STEPS = ["اقتراحك", "التواصل والإرسال"];
const PHONE = /^(\+?966|0)?5\d{8}$/;
const MAX_PHOTOS = 3;
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * The customer form behind a QR code. The customer first picks a complaint or a
 * suggestion. A complaint has three short steps: what happened (reason,
 * details, photos), the order (source, number) and how to reply (WhatsApp, a
 * call or email). A suggestion skips the reason and the order. Both end with a
 * confirmation and a tracking number.
 */
export default function PublicIntake({ code }: { code: string }) {
  const [requestKey] = useState(() => crypto.randomUUID());
  const [context, setContext] = useState<Context | null>(null),
    [kind, setKind] = useState<Kind | null>(null),
    [step, setStep] = useState(0),
    [category, setCategory] = useState(""),
    [otherDetail, setOtherDetail] = useState(""),
    [description, setDescription] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [platform, setPlatform] = useState(""),
    [externalOrder, setExternalOrder] = useState(""),
    [name, setName] = useState(""),
    [contact, setContact] = useState<Contact>("whatsapp"),
    [phone, setPhone] = useState(""),
    [email, setEmail] = useState(""),
    [consent, setConsent] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState<Result | null>(null),
    [uploadError, setUploadError] = useState(""),
    [copied, setCopied] = useState(false),
    [region, setRegion] = useState(""),
    [branchId, setBranchId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLElement>(null);

  useEffect(() => {
    api<Context>("public/q/" + code)
      .then((c) => {
        setContext(c);
      })
      .catch((e) => setError(e.message));
  }, [code]);

  const reasons = useMemo(
    () =>
      (context?.categories ?? activeCategories())
        .filter((c) => c.id !== SUGGESTION.id)
        .map(({ id, label }) => ({ id, label })),
    [context],
  );
  const suggesting = kind === "suggestion";
  const steps = suggesting ? SUGGESTION_STEPS : COMPLAINT_STEPS;
  // A suggestion uses the first and last screens only (no order details).
  const shown = suggesting && step === 2 ? 1 : step;
  const platforms = context?.platforms ?? activePlatforms();
  const picked = reasons.find((r) => r.id === category);
  // Brand QR: the customer picks the region, then that region's branch (grouped
  // by city). Nothing is chosen for them.
  const pickList = context?.branches ?? [];
  const choosing = pickList.length > 0;
  const regionOptions = regionsWith(pickList);
  const cityGroups = region
    ? citiesIn(pickList, region).map((c) => ({
        city: c,
        branches: pickList.filter((b) => b.region === region && b.city.trim() === c),
      }))
    : [];
  const branchName = choosing
    ? (pickList.find((b) => b.id === branchId)?.name ?? "")
    : (context?.branch ?? "");
  // All three ways are always offered: the phone or email is saved with the
  // complaint either way; the automatic confirmation is sent only when that
  // channel is switched on.
  const contacts: Contact[] = ["whatsapp", "call", "email"];
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function go(next: number) {
    setError("");
    setStep(next);
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function choose(next: Kind) {
    setKind(next);
    go(0);
  }
  function checkStep(): string {
    if (step === 0) {
      if (!suggesting && !picked) return "اختر سبب البلاغ";
      if (!suggesting && picked && asksDetail(picked) && otherDetail.trim().length < 3)
        return "اكتب نوع المشكلة";
      if (choosing && !region) return "اختر المنطقة";
      if (choosing && !branchId) return "اختر الفرع";
      if (suggesting && !description.trim()) return "اكتب اقتراحك";
    }
    if (step === 2) {
      if (contact === "email" && !/^\S+@\S+\.\S+$/.test(email.trim()))
        return "اكتب بريداً إلكترونياً صحيحاً";
      if (contact !== "email" && !PHONE.test(phone.replace(/[\s-]/g, "")))
        return "اكتب رقم جوال سعودي صحيح، مثل 0512345678";
      if (!consent) return "وافق على إشعار الخصوصية لإرسال البلاغ";
    }
    return "";
  }
  function addPhotos(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    if (fileInput.current) fileInput.current.value = "";
    if (chosen.some((f) => f.size > MAX_BYTES))
      return setError("حجم الصورة يجب ألا يزيد عن 5 ميغابايت");
    if (files.length + chosen.length > MAX_PHOTOS)
      setError(`يمكن إرفاق ${MAX_PHOTOS} صور كحد أقصى`);
    else setError("");
    setFiles([...files, ...chosen].slice(0, MAX_PHOTOS));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const problem = checkStep();
    if (problem) return setError(problem);
    if (step < 2) return go(suggesting ? 2 : step + 1);
    setError("");
    setBusy(true);
    try {
      const result = await api<Result>(
        "public/q/" + code,
        {
          category: suggesting ? SUGGESTION.id : category,
          otherDetail: !suggesting && picked && asksDetail(picked) ? otherDetail.trim() : "",
          description: description.trim(),
          platform: suggesting ? "" : platform,
          externalOrder: suggesting ? "" : externalOrder.trim(),
          name: name.trim(),
          phone: contact === "email" ? "" : phone.replace(/[\s-]/g, ""),
          email: contact === "email" ? email.trim() : "",
          consent: true,
          whatsappConsent: contact === "whatsapp",
          emailConsent: contact === "email",
          ...(choosing ? { branchId } : {}),
        },
        { headers: { "Idempotency-Key": requestKey } },
      );
      setReceipt(result);
      window.scrollTo({ top: 0 });
      await attach(result);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  async function attach(result: Result) {
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
  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(new URL("/track/" + token, location.href).href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const sentBy =
    contact === "whatsapp"
      ? context?.whatsappAvailable
        ? "أرسلنا رقم البلاغ على واتساب. احتفظ فيه للمتابعة."
        : "بنتواصل معك على واتساب قريباً. احتفظ برقم البلاغ للمتابعة."
      : contact === "email"
        ? context?.emailAvailable
          ? "أرسلنا رقم البلاغ إلى بريدك الإلكتروني."
          : "بنتواصل معك عبر بريدك الإلكتروني قريباً. احتفظ برقم البلاغ للمتابعة."
        : "بنتصل عليك قريباً. احتفظ برقم البلاغ للمتابعة.";
  // Delivery notes only when a confirmation was actually attempted.
  const quiet = (status?: string) =>
    !status || ["NOT_REQUESTED", "NOT_CONFIGURED"].includes(status);

  return (
    <main className="public-shell qf" ref={top}>
      <div className="public-top">
        <img src="/logos/aliz.webp" alt="أليز غلوب" />
        <span>نهتم بتجربتك</span>
      </div>
      {!context ? (
        <section className="public-card padded">
          <h1>{error ? "الرابط غير متاح" : "جارٍ تحميل بيانات الفرع…"}</h1>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      ) : receipt ? (
        <section className="qf-done">
          <span className="qf-done-tick" aria-hidden="true">
            <CheckCircle2 size={42} strokeWidth={2} />
          </span>
          <h1>{suggesting ? "وصلنا اقتراحك، شكراً لك" : "وصلنا بلاغك، شكراً لك"}</h1>
          <small>رقم البلاغ</small>
          <div className="qf-number" dir="ltr">
            {receipt.number}
          </div>
          <p className="qf-lead">{sentBy}</p>
          <a className="primary qf-wide" href={"/track/" + receipt.trackingToken}>
            متابعة حالة البلاغ <ArrowLeft size={18} />
          </a>
          <button
            type="button"
            className="text-btn qf-copy"
            onClick={() => copyLink(receipt.trackingToken)}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "تم نسخ الرابط" : "نسخ رابط المتابعة"}
          </button>
          {!quiet(receipt.confirmationStatus) &&
            confirmationLabels[receipt.confirmationStatus!] && (
              <p role="status" className="notice">
                {confirmationLabels[receipt.confirmationStatus!]}
              </p>
            )}
          {!quiet(receipt.emailStatus) && emailConfirmationLabels[receipt.emailStatus!] && (
            <p role="status" className="notice">
              {emailConfirmationLabels[receipt.emailStatus!]}
            </p>
          )}
          {uploadError && (
            <div role="alert">
              <p className="error">{uploadError}</p>
              <button className="secondary" onClick={() => attach(receipt)}>
                إعادة رفع الصور
              </button>
            </div>
          )}
          <div className="qf-card qf-next">
            <b>وش يصير بعدها؟</b>
            <ol>
              {suggesting ? (
                <>
                  <li>
                    <b>نقرأ اقتراحك</b> — يستلمه فريق خدمة العملاء.
                  </li>
                  <li>
                    <b>نشاركه مع الفريق المختص</b> — لدراسته.
                  </li>
                  <li>
                    <b>نتواصل معك</b> — إذا احتجنا تفاصيل أكثر.
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <b>نراجع بلاغك</b> — يستلمه فريق خدمة العملاء خلال دقائق.
                  </li>
                  <li>
                    <b>نتواصل معك</b> — بالطريقة اللي اخترتها.
                  </li>
                  <li>
                    <b>نحل المشكلة</b> — وتتابع كل خطوة من رابط المتابعة.
                  </li>
                </>
              )}
            </ol>
          </div>
          {receipt.receipt && <ReceiptDetails receipt={receipt.receipt} />}
          <p className="hint">الرابط خاص بك ويعرض تفاصيل بلاغك وحالته، احفظه في مكان آمن.</p>
        </section>
      ) : (
        <>
          <div className="qf-brand">
            <img src={"/logos/" + context.logo} alt="" />
            <div>
              <b>{context.brand}</b>
              <small>
                {context.demo
                  ? "فرع تجريبي • لا تدخل بيانات حقيقية"
                  : branchName || (choosing && kind ? "اختر الفرع في الخطوة الأولى" : "")}
              </small>
            </div>
          </div>
          {context.demo && (
            <div className="notice">نموذج تجريبي محلي. البيانات المُدخلة تُحفظ للتجربة فقط.</div>
          )}
          {!kind ? (
            <section className="qf-start" aria-label="نوع الطلب">
              <h1>كيف نقدر نساعدك؟</h1>
              <p className="qf-lead">اختر نوع رسالتك.</p>
              <div className="qf-kinds">
                <button type="button" className="qf-kind" onClick={() => choose("complaint")}>
                  <span className="qf-kind-icon complaint" aria-hidden="true">
                    <MessageSquareWarning size={26} strokeWidth={1.8} />
                  </span>
                  <span>
                    <b>شكوى</b>
                    <small>مشكلة في طلبك أو في الخدمة</small>
                  </span>
                  <ArrowLeft size={20} aria-hidden="true" />
                </button>
                <button type="button" className="qf-kind" onClick={() => choose("suggestion")}>
                  <span className="qf-kind-icon suggestion" aria-hidden="true">
                    <Lightbulb size={26} strokeWidth={1.8} />
                  </span>
                  <span>
                    <b>اقتراح</b>
                    <small>فكرة أو ملاحظة تساعدنا نتحسن</small>
                  </span>
                  <ArrowLeft size={20} aria-hidden="true" />
                </button>
              </div>
            </section>
          ) : (
            <>
              <div className="qf-progress" aria-hidden="true">
                {steps.map((s, i) => (
                  <i key={s} className={i <= shown ? "on" : ""} />
                ))}
              </div>
              <div className="qf-step-meta">
                <span>{steps[shown]}</span>
                <span>
                  الخطوة {shown + 1} من {steps.length}
                </span>
              </div>
              <form onSubmit={submit} onChange={() => error && setError("")} noValidate>
                <section hidden={step !== 0} aria-label={steps[0]}>
                  <h1>{suggesting ? "شاركنا اقتراحك" : "وش صار؟"}</h1>
                  <p className="qf-lead">
                    {suggesting
                      ? "اختر الفرع واكتب فكرتك أو ملاحظتك، يهمنا نسمع منك."
                      : "اختر سبب البلاغ واكتب لنا وش صار، ونتواصل معك بأسرع وقت."}
                  </p>
                  {!suggesting && (
                    <div className="qf-card">
                      <span className="qf-label">سبب البلاغ</span>
                      <ReasonCards reasons={reasons} value={category} onChange={setCategory} />
                      {picked && asksDetail(picked) && (
                        <input
                          className="qf-reveal"
                          aria-label="نوع المشكلة"
                          value={otherDetail}
                          onChange={(e) => setOtherDetail(e.target.value)}
                          maxLength={120}
                          autoFocus
                          placeholder="اكتب نوع المشكلة بكلمات قليلة"
                        />
                      )}
                    </div>
                  )}
                  {choosing && (
                    <div className="qf-card qf-branch">
                      <span className="qf-label">الفرع</span>
                      <select
                        aria-label="المنطقة"
                        value={region}
                        onChange={(e) => {
                          setRegion(e.target.value);
                          setBranchId("");
                        }}
                      >
                        <option value="">اختر المنطقة</option>
                        {regionOptions.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      {region && (
                        <select
                          aria-label="الفرع"
                          value={branchId}
                          onChange={(e) => setBranchId(e.target.value)}
                        >
                          <option value="">اختر الفرع</option>
                          {cityGroups.map((g) => (
                            <optgroup key={g.city} label={g.city}>
                              {g.branches.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  <div className="qf-card">
                    <label className="qf-label" htmlFor="qf-desc">
                      {suggesting ? "اقتراحك" : "تفاصيل المشكلة"}
                    </label>
                    <textarea
                      id="qf-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={4000}
                      rows={5}
                      placeholder={
                        suggesting
                          ? "مثال: ودنا تضيفون خيار صوص حار مع الوجبات."
                          : "مثال: وصل الطلب بعد ساعة وكان البرقر بارد وناقص البطاطس."
                      }
                    />
                    <div className="qf-counter">
                      <span dir="ltr">{description.length} / 4000</span>
                    </div>
                  </div>
                  <div className="qf-card">
                    <span className="qf-label">
                      {suggesting ? "صور" : "صور الطلب"}{" "}
                      <small>اختياري • حتى {MAX_PHOTOS} صور</small>
                    </span>
                    <div className="qf-photos">
                      {previews.map((src, i) => (
                        <div className="qf-photo filled" key={src}>
                          <img src={src} alt={`الصورة ${i + 1}`} />
                          <button
                            type="button"
                            aria-label={`حذف الصورة ${i + 1}`}
                            onClick={() => setFiles(files.filter((_, j) => j !== i))}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      {files.length < MAX_PHOTOS && (
                        <button
                          type="button"
                          className="qf-photo"
                          onClick={() => fileInput.current?.click()}
                        >
                          <Camera size={24} />
                          أضف صورة
                        </button>
                      )}
                    </div>
                    <input
                      ref={fileInput}
                      className="upload-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      tabIndex={-1}
                      aria-hidden="true"
                      onChange={(e) => addPhotos(e.target.files)}
                    />
                    <p className="hint">
                      الصور تساعدنا نحل المشكلة أسرع. لا ترفق بطاقات أو بيانات دفع.
                    </p>
                  </div>
                </section>

                <section hidden={step !== 1} aria-label={COMPLAINT_STEPS[1]}>
                  <h1>من وين طلبت؟</h1>
                  <p className="qf-lead">هذي المعلومات تساعدنا نلقى طلبك بسرعة. تقدر تتخطاها.</p>
                  <div className="qf-card">
                    <span className="qf-label">منصة الطلب</span>
                    <PlatformTiles
                      platforms={platforms}
                      brand={context.brand}
                      logo={context.logo}
                      value={platform}
                      onChange={setPlatform}
                    />
                  </div>
                  <div className="qf-card">
                    <label className="qf-label" htmlFor="qf-order">
                      {platform && platformKind(platform, context.brand) === "branch"
                        ? "رقم الفاتورة"
                        : "رقم الطلب"}{" "}
                      <small>اختياري</small>
                    </label>
                    <input
                      id="qf-order"
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={100}
                      value={externalOrder}
                      onChange={(e) => setExternalOrder(e.target.value)}
                      placeholder="مثال: 482915"
                    />
                    <p className="hint">
                      {orderHint(platform, platform ? platformKind(platform, context.brand) : null)}
                    </p>
                  </div>
                </section>

                <section hidden={step !== 2} aria-label={steps[steps.length - 1]}>
                  <h1>كيف نرد عليك؟</h1>
                  <p className="qf-lead">
                    {suggesting
                      ? "اختر الطريقة اللي تناسبك ونرسل لك رقم المتابعة."
                      : "اختر الطريقة اللي تناسبك ونرسل لك رقم البلاغ وأي تحديث."}
                  </p>
                  <div className="qf-card">
                    <label className="qf-label" htmlFor="qf-name">
                      اسمك <small>اختياري</small>
                    </label>
                    <input
                      id="qf-name"
                      autoComplete="name"
                      maxLength={100}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="الاسم"
                    />
                    {contacts.length > 1 && (
                      <>
                        <span className="qf-label qf-gap">طريقة التواصل</span>
                        <div className="qf-contacts" role="radiogroup" aria-label="طريقة التواصل">
                          {contacts.map((c) => {
                            const Icon =
                              c === "whatsapp" ? MessageCircle : c === "call" ? Phone : Mail;
                            return (
                              <label
                                key={c}
                                className={"qf-contact" + (contact === c ? " on" : "")}
                              >
                                <input
                                  type="radio"
                                  name="contact"
                                  checked={contact === c}
                                  onChange={() => setContact(c)}
                                />
                                <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
                                {c === "whatsapp"
                                  ? "واتساب"
                                  : c === "call"
                                    ? "اتصال"
                                    : "بريد إلكتروني"}
                              </label>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {contact === "email" ? (
                      <>
                        <label className="qf-label qf-gap" htmlFor="qf-email">
                          البريد الإلكتروني
                        </label>
                        <input
                          id="qf-email"
                          type="email"
                          dir="ltr"
                          maxLength={200}
                          autoComplete="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="name@example.com"
                        />
                      </>
                    ) : (
                      <>
                        <label className="qf-label qf-gap" htmlFor="qf-phone">
                          {contact === "whatsapp" ? "رقم الواتساب" : "رقم الجوال"}
                        </label>
                        <input
                          id="qf-phone"
                          type="tel"
                          dir="ltr"
                          inputMode="tel"
                          autoComplete="tel"
                          maxLength={16}
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="05xxxxxxxx"
                        />
                      </>
                    )}
                  </div>
                  <div className="qf-card">
                    <div className="qf-summary-head">
                      <span className="qf-label">
                        {suggesting ? "ملخص الاقتراح" : "ملخص البلاغ"}
                      </span>
                      <button type="button" className="text-btn" onClick={() => go(0)}>
                        تعديل
                      </button>
                    </div>
                    <dl className="qf-summary">
                      {(suggesting
                        ? [
                            ["النوع", "اقتراح"],
                            ...(choosing ? [["الفرع", branchName || "—"]] : []),
                            ["الاقتراح", description.trim() || "—"],
                            ["الصور", files.length ? `${files.length} صورة` : "لا يوجد"],
                          ]
                        : [
                            [
                              "السبب",
                              picked && asksDetail(picked) && otherDetail.trim()
                                ? otherDetail.trim()
                                : (picked?.label ?? "—"),
                            ],
                            ...(choosing ? [["الفرع", branchName || "—"]] : []),
                            ["التفاصيل", description.trim() || "—"],
                            ["المنصة", platform || "—"],
                            ["رقم الطلب", externalOrder.trim() || "—"],
                            ["الصور", files.length ? `${files.length} صورة` : "لا يوجد"],
                          ]
                      ).map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <div className="public-privacy">
                    <ShieldCheck size={19} />
                    <p>
                      تستخدم شركة أليز غلوب معلوماتك فقط لمعالجة بلاغك والتواصل معك بخصوصه، ولا
                      نبيعها أو نستخدمها للتسويق. نحتفظ بها سنتين بعد إغلاق البلاغ ثم نحذفها. لا
                      ترفق بيانات دفع أو مستندات شخصية.{" "}
                      <a href="/privacy" target="_blank" rel="noopener">
                        اقرأ إشعار الخصوصية
                      </a>
                    </p>
                  </div>
                  <label className="checkbox qf-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    <span>
                      اطلعت على{" "}
                      <a href="/privacy" target="_blank" rel="noopener">
                        إشعار الخصوصية
                      </a>{" "}
                      وأوافق على تسجيل {suggesting ? "الاقتراح" : "البلاغ"} ومعالجة بياناتي لهذا
                      الغرض.
                    </span>
                  </label>
                </section>

                {error && (
                  <p className="error qf-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="qf-actions">
                  <div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        step > 0 ? go(suggesting ? 0 : step - 1) : (setError(""), setKind(null))
                      }
                    >
                      {step === 0 && <ArrowRight size={18} />}
                      رجوع
                    </button>
                    <button className="primary" type="submit" disabled={busy}>
                      {busy
                        ? "جارٍ الإرسال…"
                        : step < 2
                          ? "التالي"
                          : suggesting
                            ? "إرسال الاقتراح"
                            : "إرسال البلاغ"}
                      {!busy && <ArrowLeft size={18} />}
                    </button>
                  </div>
                </div>
              </form>
            </>
          )}
        </>
      )}
      {context && (
        <HelpWidget
          raised={!receipt}
          greeting={
            suggesting
              ? `مرحباً، عندي اقتراح لـ ${context.brand}${branchName ? " - " + branchName : ""}`
              : `مرحباً، عندي مشكلة في طلب من ${context.brand}${branchName ? " - " + branchName : ""}`
          }
        />
      )}
      <div className="public-footer">
        <ShieldCheck size={15} /> متابعة آمنة • أليز غلوب
      </div>
    </main>
  );
}
