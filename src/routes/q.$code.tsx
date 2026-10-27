import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { publicCreate, publicQrInfo } from "@/server/public.functions";
import { categories, categoryLabels } from "@/lib/domain";
import { brandLogos, alizLogo } from "@/lib/logos";

export const Route = createFileRoute("/q/$code")({
  head: () => ({ meta: [{ title: "شاركنا ملاحظتك" }, { name: "description", content: "تقديم ملاحظة عن طلب الاستلام" }, { property: "og:title", content: "شاركنا ملاحظتك" }, { property: "og:description", content: "تقديم ملاحظة عن طلب الاستلام" }, { name: "robots", content: "noindex" }] }),
  component: PublicIntake,
});

function PublicIntake() {
  const { code } = Route.useParams();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof publicQrInfo>> | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [f, setF] = useState({ category: "DELAY", description: "", name: "", phone: "", platform: "", externalOrder: "", consent: false });
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<{ number: string; trackingToken: string | null } | null>(null);
  useEffect(() => { publicQrInfo({ data: { code } }).then(setInfo).catch(() => setInfo({ ok: false, message: "الرابط غير متاح" })); }, [code]);
  if (!info) return <p className="p-10 text-center">…</p>;
  const logo = info.ok ? brandLogos[info.logo] ?? alizLogo : alizLogo;
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <div className="space-y-4 rounded-xl border bg-card p-6">
        <img src={logo} alt={info.ok ? info.brandName : "أليز غلوب"} className="mx-auto h-24 w-24 object-contain" />
        {!info.ok && <p className="text-center font-bold">{info.message}</p>}
        {info.ok && done && (
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-extrabold">تم استلام ملاحظتك</h1>
            <p className="text-2xl font-extrabold text-primary ltr">{done.number}</p>
            {done.trackingToken && <Link className="btn-primary" to="/track/$token" params={{ token: done.trackingToken }}>متابعة الحالة</Link>}
          </div>
        )}
        {info.ok && !done && (
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); setMsg("");
            try {
              const r = await publicCreate({ data: { code, key, input: { category: f.category, description: f.description, name: f.name || undefined, phone: f.phone || undefined, platform: f.platform || undefined, externalOrder: f.externalOrder || undefined, consent: true } } });
              setDone(r);
            } catch (err) { setMsg(err instanceof Error ? err.message : "تعذر الإرسال"); }
          }}>
            <p className="text-center text-sm text-muted-foreground">{info.brandName} · {info.branchName}</p>
            <label className="field">نوع الملاحظة<select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{categories.map((c) => <option key={c} value={c}>{categoryLabels[c]}</option>)}</select></label>
            <label className="field">التفاصيل<textarea required minLength={10} className="input min-h-28 py-2" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            <label className="field">الاسم (اختياري)<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field">الجوال (اختياري)<input className="input ltr" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
            <label className="field">رقم الطلب (اختياري)<input className="input ltr" value={f.externalOrder} onChange={(e) => setF({ ...f, externalOrder: e.target.value })} /></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /> أوافق على استخدام بياناتي لمعالجة هذه الملاحظة فقط.</label>
            {msg && <p role="alert" className="error-text">{msg}</p>}
            <button className="btn-primary w-full">إرسال</button>
          </form>
        )}
      </div>
    </main>
  );
}
