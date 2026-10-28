import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, LoaderCircle, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { claimFirstAdmin } from "@/functions/admin.functions";

// Steps this backend adds after the password: two-factor (required before any
// data is readable) and, for a brand-new account, the one-time first-admin
// claim. Same layout and classes as the sign-in screen.
export function AccessGate({
  code,
  onDone,
  onSignOut,
}: {
  code: "MFA_REQUIRED" | "NO_ACCESS" | "DISABLED";
  onDone: () => Promise<void>;
  onSignOut: () => void;
}) {
  const [aal, setAal] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.mfa
      .getAuthenticatorAssuranceLevel()
      .then(({ data }) => setAal(data?.currentLevel ?? null));
  }, []);
  if (code === "MFA_REQUIRED" || (code === "NO_ACCESS" && aal === "aal1"))
    return <Mfa onDone={onDone} onSignOut={onSignOut} />;
  if (code === "DISABLED")
    return (
      <Frame title="الحساب موقوف" onSignOut={onSignOut}>
        <p className="sign-in-note">تواصل مع مسؤول النظام لإعادة تفعيل حسابك.</p>
      </Frame>
    );
  return <NoAccess onDone={onDone} onSignOut={onSignOut} />;
}

function Frame({
  title,
  children,
  onSignOut,
}: {
  title: string;
  children: ReactNode;
  onSignOut: () => void;
}) {
  return (
    <main className="sign-in-page">
      <section className="sign-in-form-panel" dir="rtl">
        <header className="sign-in-header">
          <img src="/logos/aliz.webp" alt="أليز غلوب" />
        </header>
        <div className="sign-in-content">
          <div className="sign-in-form">
            <h1>{title}</h1>
            {children}
            <button type="button" className="secondary" onClick={onSignOut}>
              <LogOut size={18} /> تسجيل الخروج
            </button>
          </div>
        </div>
      </section>
      <aside className="sign-in-brand-panel" aria-label="أليز غلوب">
        <img className="sign-in-display-logo" src="/logos/aliz.webp" alt="Aliz Globe Company" />
      </aside>
    </main>
  );
}

function Mfa({ onDone, onSignOut }: { onDone: () => Promise<void>; onSignOut: () => void }) {
  const [factorId, setFactorId] = useState<string | null>(null),
    [qr, setQr] = useState<string | null>(null),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === "verified");
      if (verified) return setFactorId(verified.id);
      for (const f of data?.all ?? [])
        if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: enrolled, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Aliz CRM",
      });
      if (error) return setError("تعذر بدء تسجيل التحقق بخطوتين. حدّث الصفحة.");
      setFactorId(enrolled.id);
      setQr(enrolled.totp.qr_code);
    })();
  }, []);
  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      setBusy(false);
      return setError("الرمز غير صحيح. أدخل الرمز الحالي من تطبيق المصادقة.");
    }
    await onDone();
    setBusy(false);
  }
  return (
    <Frame title="التحقق بخطوتين" onSignOut={onSignOut}>
      <form className="sign-in-mfa" onSubmit={verify}>
        <p className="sign-in-note">
          {qr
            ? "امسح الرمز بتطبيق المصادقة، ثم أدخل الرمز المكوّن من 6 أرقام."
            : "أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة."}
        </p>
        {qr && <img className="sign-in-mfa-qr" src={qr} alt="رمز تسجيل تطبيق المصادقة" />}
        <label className="field">
          <span>رمز التحقق</span>
          <input
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            disabled={busy}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy || code.length !== 6}>
          {busy ? (
            <>
              <LoaderCircle className="spin" size={18} /> جارٍ التحقق…
            </>
          ) : (
            <>
              تأكيد الدخول <ArrowLeft size={18} />
            </>
          )}
        </button>
      </form>
    </Frame>
  );
}

function NoAccess({ onDone, onSignOut }: { onDone: () => Promise<void>; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Frame title="لا توجد صلاحية مسندة" onSignOut={onSignOut}>
      <p className="sign-in-note">
        لم يُمنح هذا الحساب دوراً بعد. يمنح مسؤول النظام الأدوار ونطاق العلامات والفروع.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await claimFirstAdmin();
            await onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        تعيين مسؤول النظام الأول (مرة واحدة)
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Frame>
  );
}
