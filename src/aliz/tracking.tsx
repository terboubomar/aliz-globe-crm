import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  Wrench,
} from "lucide-react";
import { api } from "./types";
import { HelpWidget } from "./public-help";
import { TRACK_STEPS, trackMessage, trackStep } from "@/lib/tracking-steps";

type Status = {
  number: string;
  state: string;
  createdAt: string;
  logo?: string;
  startedAt?: string | null;
  solvedAt?: string | null;
  closedAt?: string | null;
  receipt?: { brand: string; branch: string; category: string };
};

const when = (iso?: string | null) =>
  iso
    ? new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
        calendar: "gregory",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Riyadh",
      }).format(new Date(iso))
    : "";

const STEP_ICONS = [ClipboardCheck, UsersRound, Wrench, CheckCircle2];
const STEP_SHORT = ["الاستلام", "الفريق", "الحل", "تم"];
const clock = (iso?: string | null) =>
  iso
    ? new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Riyadh",
      }).format(new Date(iso))
    : "";

/**
 * The customer's private tracking page (/track/:token): where the complaint is
 * now, a four-step timeline, the complaint details and the help widget. It
 * refreshes itself every minute while open.
 */
export default function Tracking({ token }: { token: string }) {
  const [data, setData] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api<Status>("public/status/" + token));
      setError("");
      setCheckedAt(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const { step, finished } = trackStep(data?.state ?? "NEW");
  const message = trackMessage(data?.state ?? "NEW");
  const times = [
    data?.createdAt,
    null,
    data?.startedAt,
    data?.state === "CLOSED" ? (data?.closedAt ?? data?.solvedAt) : data?.solvedAt,
  ];

  return (
    <main className="public-shell qf tk">
      <div className="public-top">
        <img src="/logos/aliz.webp" alt="أليز غلوب" />
        <span>متابعة البلاغ</span>
      </div>

      {!data && !error && (
        <section className="qf-card tk-loading" aria-busy="true">
          جارٍ تحميل حالة بلاغك…
        </section>
      )}

      {!data && error && (
        <section className="qf-card tk-missing">
          <ShieldCheck size={40} />
          <h1>الرابط غير متاح</h1>
          <p className="qf-lead">
            {error}. إذا كنت تحتاج مساعدة بخصوص بلاغك تواصل معنا وبنخدمك مباشرة.
          </p>
          <button type="button" className="secondary" onClick={load} disabled={busy}>
            <RefreshCw size={16} /> حاول مرة أخرى
          </button>
        </section>
      )}

      {data && (
        <>
          <section className={"tk-hero " + message.tone} aria-live="polite">
            <div className="tk-hero-top">
              {data.logo ? (
                <span className="tk-hero-logo">
                  <img src={"/logos/" + data.logo} alt="" />
                </span>
              ) : null}
              <div className="tk-hero-brand">
                <b>{data.receipt?.brand}</b>
                <small>{data.receipt?.branch}</small>
              </div>
              <div className="tk-hero-number">
                <small>رقم البلاغ</small>
                <b dir="ltr">{data.number}</b>
              </div>
            </div>
            <div className="tk-hero-status">
              <span className="tk-hero-icon" aria-hidden="true">
                {message.tone === "done" ? <CheckCircle2 size={24} /> : <Clock3 size={24} />}
              </span>
              <div>
                <h1>{message.title}</h1>
                <p>{message.body}</p>
              </div>
            </div>
            <ol className="tk-track" aria-label="مراحل البلاغ">
              {TRACK_STEPS.map((label, i) => {
                const done = i < step || (i === step && finished);
                const current = i === step && !finished;
                const Icon = STEP_ICONS[i]!;
                return (
                  <li
                    key={label}
                    className={done ? "done" : current ? "current" : ""}
                    aria-current={current ? "step" : undefined}
                  >
                    <span className="tk-track-dot" aria-hidden="true">
                      {done ? (
                        <Check size={16} strokeWidth={3} />
                      ) : (
                        <Icon size={16} strokeWidth={2} />
                      )}
                    </span>
                    <b>{STEP_SHORT[i]}</b>
                    <small>{(done || current) && times[i] ? clock(times[i]) : " "}</small>
                    <span className="sr-only">{label}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="qf-card tk-details">
            <span className="qf-label">تفاصيل البلاغ</span>
            <dl>
              {[
                ["السبب", data.receipt?.category || "—"],
                ["الفرع", data.receipt?.branch || "—"],
                ["تاريخ الاستلام", when(data.createdAt) || "—"],
                ["المرحلة", TRACK_STEPS[step]],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="tk-refresh">
            <span>
              {checkedAt
                ? "آخر تحديث " +
                  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: "Asia/Riyadh",
                  }).format(checkedAt)
                : ""}
            </span>
            <button type="button" className="text-btn" onClick={load} disabled={busy}>
              <RefreshCw size={15} className={busy ? "spin" : ""} /> تحديث الحالة
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <p className="hint tk-hint">
            هذا الرابط خاص بك ويعرض حالة بلاغك فقط. احفظه للرجوع له في أي وقت.
          </p>
        </>
      )}

      <HelpWidget
        raised={false}
        greeting={
          data
            ? `مرحباً، أتابع بلاغ رقم ${data.number} (${data.receipt?.brand ?? ""} - ${data.receipt?.branch ?? ""})`
            : "مرحباً، أحتاج مساعدة بخصوص بلاغ"
        }
      />
      <div className="public-footer">
        <ShieldCheck size={15} /> متابعة آمنة • أليز غلوب
      </div>
    </main>
  );
}
