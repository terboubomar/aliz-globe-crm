import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { alizLogo, brandLogos } from "@/lib/logos";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — أليز غلوب" },
      { name: "description", content: "دخول موظفي أليز غلوب إلى نظام الشكاوى" },
      { property: "og:title", content: "تسجيل الدخول — أليز غلوب" },
      { property: "og:description", content: "دخول موظفي أليز غلوب إلى نظام الشكاوى" },
    ],
  }),
  component: SignIn,
});

// Staff sign-in only. Public sign-up is disabled; accounts are provisioned by the system administrator.
function SignIn() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) nav({ to: "/dashboard" }); });
  }, [nav]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError("بيانات الدخول غير صحيحة");
    nav({ to: "/dashboard" });
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="panel w-full max-w-sm space-y-4 p-8">
        <img src={alizLogo} alt="أليز غلوب" className="mx-auto h-24 w-24 object-contain" />
        <h1 className="text-center text-xl font-extrabold text-ink">تسجيل الدخول</h1>
        <label className="field">البريد الإلكتروني
          <input className="input ltr" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">كلمة المرور
          <input className="input ltr" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert" className="error-text">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "جارٍ الدخول…" : "دخول"}</button>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2" aria-label="علامات المجموعة">
          {Object.entries(brandLogos).map(([id, src]) => (
            <img key={id} src={src} alt="" className="h-9 w-9 rounded-sm object-contain" />
          ))}
        </div>
      </form>
    </main>
  );
}
