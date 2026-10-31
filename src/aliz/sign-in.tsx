import { useState, useEffect, FormEvent } from "react";
import { api } from "./types";
import { ArrowLeft, Eye, EyeOff, Fingerprint, LoaderCircle } from "lucide-react";
import { PASSKEYS_ENABLED, deviceSupportsPasskey } from "@/lib/passkey-errors";
export function SignIn({
  onSignIn,
  onPasskey,
  checking,
  connectionError,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
  /** Sign in with Face ID / Touch ID (a passkey saved on this device). */
  onPasskey?: () => Promise<void>;
  checking: boolean;
  connectionError: string;
}) {
  const [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [auth, setAuth] = useState<{ mode: string; available: boolean } | null>(null);
  const [passkey, setPasskey] = useState(false);
  useEffect(() => {
    if (PASSKEYS_ENABLED) deviceSupportsPasskey().then(setPasskey);
  }, []);
  async function withPasskey() {
    if (!onPasskey) return;
    setBusy(true);
    setError("");
    try {
      await onPasskey();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    api<{ mode: string; available: boolean }>("auth/options")
      .then(setAuth)
      .catch(() => setError("تعذر تحميل خيارات تسجيل الدخول. حدّث الصفحة."));
    if (new URLSearchParams(window.location.search).get("authError"))
      setError("تعذر تسجيل الدخول المؤسسي. تحقق من حسابك والمصادقة المتعددة وحاول مجدداً.");
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onSignIn(String(fields.get("email")), String(fields.get("password")));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="sign-in-page">
      <section className="sign-in-form-panel" dir="rtl">
        <header className="sign-in-header">
          <img src="/logos/aliz.webp" alt="أليز غلوب" />
        </header>
        <div className="sign-in-content">
          <form className="sign-in-form" onSubmit={submit}>
            <h1>تسجيل الدخول</h1>
            {auth?.mode === "oidc" ? (
              <>
                {auth.available ? (
                  <a
                    className="primary sso-login"
                    href={
                      "/api/auth/oidc/start?returnTo=" +
                      encodeURIComponent(
                        typeof window === "undefined"
                          ? "/"
                          : window.location.pathname + window.location.search,
                      )
                    }
                  >
                    الدخول بالهوية المؤسسية <ArrowLeft size={18} />
                  </a>
                ) : (
                  <p className="error" role="alert">
                    تسجيل الدخول المؤسسي بانتظار التهيئة من مسؤول النظام.
                  </p>
                )}
                {(error || connectionError) && (
                  <p className="error" role="alert">
                    {error || connectionError}
                  </p>
                )}
              </>
            ) : (
              <>
                <label className="field">
                  <span>البريد الإلكتروني</span>
                  <input
                    name="email"
                    aria-label="البريد الإلكتروني"
                    type="email"
                    dir="ltr"
                    autoComplete="username"
                    placeholder="name@company.com"
                    required
                    maxLength={254}
                    disabled={busy || checking}
                  />
                </label>
                <label className="field">
                  <span>كلمة المرور</span>
                  <span className="sign-in-password">
                    <input
                      name="password"
                      aria-label="كلمة المرور"
                      type={visible ? "text" : "password"}
                      dir="ltr"
                      autoComplete="current-password"
                      required
                      maxLength={128}
                      disabled={busy || checking}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                      aria-pressed={visible}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </span>
                </label>
                {(error || connectionError) && (
                  <p className="error" role="alert">
                    {error || connectionError}
                  </p>
                )}
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || checking || !auth?.available}
                >
                  {busy || checking ? (
                    <>
                      <LoaderCircle className="spin" size={18} />
                      {checking ? "جارٍ التحقق من الجلسة…" : "جارٍ تسجيل الدخول…"}
                    </>
                  ) : (
                    <>
                      الدخول إلى مساحة العمل <ArrowLeft size={18} />
                    </>
                  )}
                </button>
                {passkey && onPasskey && (
                  <>
                    <div className="sign-in-or" aria-hidden="true">
                      <span>أو</span>
                    </div>
                    <button
                      type="button"
                      className="secondary sign-in-passkey"
                      disabled={busy || checking}
                      onClick={withPasskey}
                    >
                      <Fingerprint size={19} />
                      الدخول بـ Face ID / Touch ID
                    </button>
                  </>
                )}
              </>
            )}
          </form>
          <div className="login-brand-logos" aria-label="علامات المجموعة">
            <img src="/logos/waqf.jpeg" alt="واقف" />
            <img src="/logos/kabab.png" alt="كباب علوم" />
            <img src="/logos/batatisyon.jpeg" alt="بطاطسيون" />
            <img src="/logos/mazmuzil.webp" alt="مزمزيل" />
          </div>
        </div>
      </section>
      <aside className="sign-in-brand-panel" aria-label="أليز غلوب">
        <img className="sign-in-display-logo" src="/logos/aliz.webp" alt="Aliz Globe Company" />
      </aside>
    </main>
  );
}
