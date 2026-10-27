import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import {
  Bell, LayoutDashboard, ListChecks, PhoneCall, Wallet, Building2, CalendarClock, BarChart3, Users, Settings, LogOut, Menu, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { bootstrapQuery, useApp, errMessage } from "@/lib/app-data";
import { alizLogo } from "@/lib/logos";
import { roleLabels } from "@/lib/domain";
import { claimFirstAdmin } from "@/functions/admin.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/" });
  },
  component: Gate,
});

function Gate() {
  const { data, isLoading, error } = useQuery(bootstrapQuery);
  if (isLoading) return <p className="p-10 text-center text-muted-foreground">جارٍ التحميل…</p>;
  if (error) return <Notice title="تعذر التحميل" body={errMessage(error)} />;
  if (data!.status === "MFA_REQUIRED") return <MfaGate />;
  if (data!.status === "DISABLED") return <Notice title="الحساب موقوف" body="تواصل مع مدير النظام." />;
  if (data!.status === "NO_ACCESS") return <NoAccess />;
  return <Shell />;
}

async function signOut() {
  await supabase.auth.signOut();
  window.location.href = "/";
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="panel w-full max-w-md space-y-4 p-8 text-center">
        <img src={alizLogo} alt="أليز غلوب" className="mx-auto h-16 w-16 object-contain" />
        <h1 className="text-lg font-extrabold text-ink">{title}</h1>
        <p className="text-muted-foreground">{body}</p>
        {children}
        <button className="btn-ghost" onClick={signOut}><LogOut size={18} /> خروج</button>
      </div>
    </main>
  );
}

function NoAccess() {
  const qc = useQueryClient();
  const [aal, setAal] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => setAal(data?.currentLevel ?? null)); }, []);
  if (aal === "aal1") return <MfaGate note="فعّل التحقق بخطوتين قبل أي صلاحية." />;
  return (
    <Notice title="لا توجد صلاحية مسندة" body="هذا الحساب لم يُمنح دوراً بعد. يمنح مدير النظام الأدوار والنطاقات.">
      <button className="btn-ghost w-full" onClick={async () => {
        try { await claimFirstAdmin(); qc.invalidateQueries(); } catch (e) { setMsg(errMessage(e)); }
      }}>تعيين مدير النظام الأول (مرة واحدة)</button>
      {msg && <p className="error-text">{msg}</p>}
    </Notice>
  );
}

function MfaGate({ note }: { note?: string }) {
  const qc = useQueryClient();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === "verified");
      if (verified) return setFactorId(verified.id);
      for (const f of data?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: en, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Aliz CRM" });
      if (error) return setMsg("تعذر بدء التسجيل");
      setFactorId(en.id); setQr(en.totp.qr_code);
    })();
  }, []);
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) return setMsg("الرمز غير صحيح");
    qc.invalidateQueries();
  }
  return (
    <Notice title="التحقق بخطوتين" body={note ?? (qr ? "امسح الرمز بتطبيق المصادقة ثم أدخل الرمز المكون من 6 أرقام." : "أدخل الرمز من تطبيق المصادقة.")}>
      {qr && <img src={qr} alt="رمز تسجيل المصادقة" className="mx-auto h-44 w-44 rounded-sm bg-card" />}
      <form onSubmit={verify} className="space-y-3">
        <input className="input ltr w-full text-center tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="رمز التحقق" />
        {msg && <p className="error-text">{msg}</p>}
        <button className="btn-primary w-full" disabled={code.length !== 6}>تحقق</button>
      </form>
    </Notice>
  );
}

const nav = [
  { to: "/dashboard", label: "لوحة المتابعة", icon: LayoutDashboard, perm: "read" },
  { to: "/complaints", label: "الشكاوى", icon: ListChecks, perm: "read" },
  { to: "/complaints/new", label: "تسجيل شكوى هاتفية", icon: PhoneCall, perm: "create" },
  { to: "/refunds", label: "الاسترداد والإلغاء", icon: Wallet, perm: "read" },
  { to: "/directory", label: "العلامات والفروع", icon: Building2, perm: "read" },
  { to: "/schedule", label: "جدول الدوام", icon: CalendarClock, perm: "read" },
  { to: "/reports", label: "التقارير", icon: BarChart3, perm: "report" },
  { to: "/users", label: "المستخدمون", icon: Users, perm: "users.manage" },
  { to: "/settings", label: "الإعدادات والتكاملات", icon: Settings, perm: "read" },
] as const;

function Shell() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [path]);
  const links = nav.filter((n) => app.has(n.perm));
  return (
    <div className="flex min-h-screen">
      {open && <button aria-label="إغلاق القائمة" className="fixed inset-0 z-30 bg-foreground/40 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 right-0 z-40 w-[254px] bg-nav p-4 transition-transform lg:static lg:translate-x-0 ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="mb-6 flex items-center gap-3">
          <img src={alizLogo} alt="أليز غلوب" className="h-11 w-11 rounded-sm bg-card object-contain" />
          <span className="font-extrabold text-nav-foreground">أليز غلوب</span>
          <button className="mr-auto text-nav-foreground lg:hidden" onClick={() => setOpen(false)} aria-label="إغلاق"><X size={20} /></button>
        </div>
        <nav className="space-y-1">
          {links.map((n) => {
            const active = path === n.to || (n.to === "/complaints" && path.startsWith("/complaints/") && path !== "/complaints/new");
            return (
              <Link key={n.to} to={n.to} className={`nav-link ${active ? "nav-link-active" : ""}`}>
                <n.icon size={19} strokeWidth={1.8} /> {n.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b bg-card px-4 py-2">
          <button className="btn-ghost px-3 lg:hidden" onClick={() => setOpen(true)} aria-label="القائمة"><Menu size={20} /></button>
          <div className="mr-auto flex items-center gap-2">
            <button className="btn-ghost px-3" aria-label="التنبيهات" onClick={() => navigate({ to: "/complaints", search: { filter: "waiting" } as never })}><Bell size={19} /></button>
            <div className="text-left leading-tight">
              <div className="text-sm font-bold">{app.me!.name}</div>
              <div className="text-xs text-muted-foreground">{roleLabels[app.me!.role]}</div>
            </div>
            <button className="btn-ghost px-3" onClick={signOut} aria-label="تسجيل الخروج"><LogOut size={19} /></button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1550px] flex-1 p-4 md:p-6">
          <Suspense fallback={<p className="text-muted-foreground">جارٍ التحميل…</p>}><Outlet /></Suspense>
        </main>
      </div>
    </div>
  );
}
