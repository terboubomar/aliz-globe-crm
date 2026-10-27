import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useApp, errMessage, idemKey } from "@/lib/app-data";
import { createPhoneComplaint } from "@/server/complaints.functions";
import { categories, categoryLabels } from "@/lib/domain";
import { PageHead } from "@/components/crm";

export const Route = createFileRoute("/_authenticated/complaints/new")({
  head: () => ({ meta: [{ title: "تسجيل شكوى هاتفية — أليز غلوب" }, { name: "description", content: "تسجيل شكوى واردة بالهاتف" }, { property: "og:title", content: "تسجيل شكوى هاتفية" }, { property: "og:description", content: "تسجيل شكوى واردة بالهاتف" }] }),
  component: NewComplaint,
});

function localNow() {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function NewComplaint() {
  const app = useApp();
  const [key, setKey] = useState(idemKey);
  const [f, setF] = useState({ brandId: "", branchId: "", unknownReason: "", category: "DELAY", priority: "P3", description: "", name: "", phone: "", externalOrder: "", platform: "", receivedAt: localNow() });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number: string; id?: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const brands = app.brands.filter((b) => b.status === "ACTIVE" && (app.me!.role === "SUPER_ADMIN" || app.me!.brandIds.includes(b.id)));
  const branches = app.branches.filter((b) => b.brand_id === f.brandId && b.active);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg("");
    try {
      const r = await createPhoneComplaint({ data: { key, input: {
        brandId: f.brandId, branchId: f.branchId || null, unknownReason: f.branchId ? undefined : f.unknownReason, category: f.category,
        priority: f.priority, description: f.description, name: f.name || undefined, phone: f.phone || undefined,
        externalOrder: f.externalOrder || undefined, platform: f.platform || undefined,
        receivedAt: new Date(f.receivedAt).toISOString(), whatsappConsent: false,
      } } });
      setDone({ number: r.number, id: (r as { id?: string }).id });
    } catch (err) { setMsg(errMessage(err)); } finally { setBusy(false); }
  }

  if (done) return (
    <div className="panel mx-auto max-w-md space-y-3 text-center">
      <h1 className="page-title">تم تسجيل الشكوى</h1>
      <p className="text-3xl font-extrabold text-primary ltr">{done.number}</p>
      <div className="flex justify-center gap-2">
        {done.id && <Link to="/complaints/$id" params={{ id: done.id }} className="btn-primary">فتح الشكوى</Link>}
        <button className="btn-ghost" onClick={() => { setDone(null); setKey(idemKey()); setF({ ...f, description: "", name: "", phone: "", externalOrder: "" }); }}>شكوى جديدة</button>
      </div>
    </div>
  );

  return (
    <>
      <PageHead title="تسجيل شكوى هاتفية" />
      {brands.length === 0 && <p className="panel mb-3 text-sm">لا توجد علامة مفعلة ضمن نطاقك. يفعّل مدير النظام العلامات والفروع من «العلامات والفروع».</p>}
      <form onSubmit={submit} className="panel grid max-w-3xl gap-4 md:grid-cols-2">
        <label className="field">العلامة<select required className="input" value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value, branchId: "" })}><option value="">اختر</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="field">الفرع<select className="input" value={f.branchId} onChange={set("branchId")}><option value="">غير معروف</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        {!f.branchId && <label className="field md:col-span-2">سبب عدم معرفة الفرع<input required className="input" value={f.unknownReason} onChange={set("unknownReason")} /></label>}
        <label className="field">وقت استلام الطلب<input type="datetime-local" required className="input ltr" value={f.receivedAt} onChange={set("receivedAt")} /></label>
        <label className="field">اسم العميل<input className="input" value={f.name} onChange={set("name")} /></label>
        <label className="field">جوال العميل<input className="input ltr" inputMode="tel" placeholder="05xxxxxxxx" value={f.phone} onChange={set("phone")} /></label>
        <label className="field">منصة الطلب<input className="input" value={f.platform} onChange={set("platform")} /></label>
        <label className="field">رقم الطلب الخارجي<input className="input ltr" value={f.externalOrder} onChange={set("externalOrder")} /></label>
        <label className="field">التصنيف<select className="input" value={f.category} onChange={set("category")}>{categories.map((c) => <option key={c} value={c}>{categoryLabels[c]}</option>)}</select></label>
        <label className="field">الأولوية<select className="input" value={f.category === "SAFETY" ? "P1" : f.priority} disabled={f.category === "SAFETY"} onChange={set("priority")}><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option></select></label>
        <label className="field md:col-span-2">الوصف<textarea required minLength={10} className="input min-h-28 py-2" value={f.description} onChange={set("description")} /></label>
        {msg && <p role="alert" className="error-text md:col-span-2">{msg}</p>}
        <button className="btn-primary md:col-span-2" disabled={busy}>{busy ? "جارٍ الحفظ…" : "تسجيل الشكوى"}</button>
      </form>
    </>
  );
}
