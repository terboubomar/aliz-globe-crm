import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, LoaderCircle, ShieldCheck, ShieldOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Phase =
  | { at: "loading" }
  | { at: "off" }
  | { at: "setup"; factorId: string; qr: string; secret: string }
  | { at: "on"; factorId: string }
  | { at: "confirm-off"; factorId: string };

/**
 * Two-step verification for the signed-in staff member, from the account menu:
 * switch it on with an authenticator app (scan, then enter the 6-digit code),
 * or switch it off. When a super admin requires it for everyone, it cannot be
 * switched off here.
 */
export function TwoStepAccount({ required }: { required: boolean }) {
  const [phase, setPhase] = useState<Phase>({ at: "loading" }),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");

  async function refresh() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return setError("تعذر قراءة حالة التحقق بخطوتين. حدّث الصفحة.");
    const verified = data?.totp.find((f) => f.status === "verified");
    setPhase(verified ? { at: "on", factorId: verified.id } : { at: "off" });
  }
  useEffect(() => {
    refresh();
  }, []);

  async function start() {
    setBusy(true);
    setError("");
    setNotice("");
    // Clear any half-finished setup first.
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.all ?? [])
      if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data: enrolled, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Aliz CRM " + new Date().toISOString().slice(0, 10),
    });
    setBusy(false);
    if (error || !enrolled) return setError("تعذر بدء التفعيل. حاول مرة أخرى.");
    setCode("");
    setPhase({
      at: "setup",
      factorId: enrolled.id,
      qr: enrolled.totp.qr_code,
      secret: enrolled.totp.secret,
    });
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (phase.at !== "setup") return;
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: phase.factorId,
      code,
    });
    setBusy(false);
    if (error) return setError("الرمز غير صحيح. أدخل الرمز الحالي من تطبيق المصادقة.");
    setNotice("تم تفعيل التحقق بخطوتين. سيُطلب الرمز عند كل تسجيل دخول.");
    setPhase({ at: "on", factorId: phase.factorId });
  }

  async function switchOff() {
    if (phase.at !== "confirm-off") return;
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.mfa.unenroll({ factorId: phase.factorId });
    setBusy(false);
    if (error) return setError("تعذر الإيقاف. سجّل الخروج ثم الدخول بالرمز وحاول مرة أخرى.");
    setNotice("تم إيقاف التحقق بخطوتين. الدخول الآن بكلمة المرور فقط.");
    setPhase({ at: "off" });
  }

  return (
    <div className="two-step">
      {phase.at === "loading" && <p className="hint">جارٍ التحميل…</p>}

      {(phase.at === "on" || phase.at === "confirm-off") && (
        <div className="two-step-state on">
          <ShieldCheck size={22} />
          <div>
            <b>التحقق بخطوتين مفعّل</b>
            <small>يُطلب رمز من تطبيق المصادقة عند كل تسجيل دخول.</small>
          </div>
        </div>
      )}
      {phase.at === "off" && (
        <div className="two-step-state">
          <ShieldOff size={22} />
          <div>
            <b>التحقق بخطوتين غير مفعّل</b>
            <small>الدخول بكلمة المرور فقط. التفعيل اختياري ويزيد حماية حسابك.</small>
          </div>
        </div>
      )}

      {phase.at === "off" && (
        <button type="button" className="primary" disabled={busy} onClick={start}>
          {busy ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}
          تفعيل التحقق بخطوتين
        </button>
      )}

      {phase.at === "setup" && (
        <form className="two-step-setup" onSubmit={verify}>
          <ol>
            <li>
              ثبّت تطبيق مصادقة على جوالك، مثل Google Authenticator أو Microsoft Authenticator.
            </li>
            <li>امسح الرمز من التطبيق، أو أدخل المفتاح يدوياً.</li>
            <li>أدخل الرمز المكوّن من 6 أرقام الظاهر في التطبيق.</li>
          </ol>
          <img src={phase.qr} alt="رمز تفعيل تطبيق المصادقة" />
          <code dir="ltr">{phase.secret}</code>
          <label className="field">
            <span>رمز التحقق</span>
            <input
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <div className="two-step-actions">
            <button type="submit" className="primary" disabled={busy || code.length !== 6}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}
              تأكيد التفعيل
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={async () => {
                await supabase.auth.mfa.unenroll({ factorId: phase.factorId });
                setPhase({ at: "off" });
              }}
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {phase.at === "on" &&
        (required ? (
          <p className="hint">التحقق بخطوتين إلزامي لجميع الحسابات حسب إعدادات النظام.</p>
        ) : (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setNotice("");
              setPhase({ at: "confirm-off", factorId: phase.factorId });
            }}
          >
            <ShieldOff size={17} /> إيقاف التحقق بخطوتين
          </button>
        ))}

      {phase.at === "confirm-off" && (
        <div className="two-step-confirm">
          <p>متأكد؟ بعد الإيقاف يكفي كلمة المرور للدخول إلى حسابك.</p>
          <div className="two-step-actions">
            <button type="button" className="two-step-off" disabled={busy} onClick={switchOff}>
              {busy ? <LoaderCircle className="spin" size={17} /> : null}
              نعم، إيقاف
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setPhase({ at: "on", factorId: phase.factorId })}
            >
              تراجع
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
