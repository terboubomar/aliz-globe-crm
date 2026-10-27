import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import QRCode from "qrcode";
import { useApp, errMessage, bootstrapQuery } from "@/lib/app-data";
import { listQrs, qrForBranch, retireQr, saveBranch, setBranchActive, updateBrand } from "@/server/admin.functions";
import { BrandLogo, PageHead } from "@/components/crm";
import { brandLogos } from "@/lib/logos";

export const Route = createFileRoute("/_authenticated/directory")({
  head: () => ({ meta: [{ title: "العلامات والفروع — أليز غلوب" }, { name: "description", content: "إدارة العلامات وفروع الاستلام ورموز QR" }, { property: "og:title", content: "العلامات والفروع" }, { property: "og:description", content: "إدارة العلامات وفروع الاستلام ورموز QR" }] }),
  component: Directory,
});

const statusLabel: Record<string, string> = { DRAFT: "مسودة", ACTIVE: "مفعلة", SUSPENDED: "موقوفة" };

function Directory() {
  const app = useApp();
  const qc = useQueryClient();
  const [brandId, setBrandId] = useState(app.brands[0]?.id ?? "");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [msg, setMsg] = useState("");
  const qrs = useQuery({ queryKey: ["qrs"], queryFn: () => listQrs(), enabled: app.has("configure") });
  const brand = app.brands.find((b) => b.id === brandId);
  const branches = app.branches.filter((b) => b.brand_id === brandId);
  const refresh = () => { qc.invalidateQueries({ queryKey: bootstrapQuery.queryKey }); qc.invalidateQueries({ queryKey: ["qrs"] }); };
  const wrap = (fn: () => Promise<unknown>) => async () => { setMsg(""); try { await fn(); refresh(); } catch (e) { setMsg(errMessage(e)); } };

  return (
    <>
      <PageHead title="العلامات والفروع" />
      {msg && <p role="alert" className="error-text mb-3">{msg}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {app.brands.map((b) => (
          <button key={b.id} onClick={() => setBrandId(b.id)} className={`panel flex flex-col items-center gap-2 ${b.id === brandId ? "border-primary" : ""}`} aria-pressed={b.id === brandId}>
            <BrandLogo id={b.id} size={56} />
            <span className="font-bold">{b.name}</span>
            <span className={b.status === "ACTIVE" ? "chip-ok" : "chip-muted"}>{statusLabel[b.status]}</span>
          </button>
        ))}
      </div>
      {brand && (
        <section className="panel space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">فروع {brand.name}</h2>
            <span className="text-xs text-muted-foreground">فروع استلام فقط — لا طاولات ولا خدمة داخلية</span>
            <div className="mr-auto flex gap-2">
              {app.has("directory.activate") && brand.status !== "ACTIVE" && <button className="btn-ghost" onClick={wrap(() => updateBrand({ data: { id: brand.id, status: "ACTIVE" } }))}>تفعيل العلامة</button>}
              {app.has("directory.activate") && brand.status === "ACTIVE" && <button className="btn-danger" onClick={wrap(() => updateBrand({ data: { id: brand.id, status: "SUSPENDED" } }))}>إيقاف العلامة</button>}
              {app.has("branches.manage") && <button className="btn-primary" onClick={() => setEditing("new")}>فرع جديد</button>}
            </div>
          </div>
          {editing && <BranchForm brandId={brandId} id={editing === "new" ? undefined : editing} onDone={() => { setEditing(null); refresh(); }} />}
          {branches.length === 0 && <p className="text-muted-foreground">لا توجد فروع بعد.</p>}
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>الفرع</th><th>الرمز</th><th>المدينة</th><th>الموقع</th><th>الحالة</th><th>QR الاستلام</th><th></th></tr></thead>
              <tbody>{branches.map((b) => {
                const qr = qrs.data?.find((q) => q.branchId === b.id);
                return (
                  <tr key={b.id}>
                    <td className="font-bold">{b.name}</td>
                    <td className="ltr">{b.code}</td>
                    <td>{b.city}{b.district ? ` · ${b.district}` : ""}</td>
                    <td>{b.maps_url ? <a className="text-primary" href={b.maps_url} target="_blank" rel="noreferrer">الخريطة</a> : "—"}</td>
                    <td><span className={b.active ? "chip-ok" : "chip-muted"}>{b.active ? "مفعل" : "غير مفعل"}</span></td>
                    <td>{app.has("configure") && b.active && <QrCell branchId={b.id} brandId={brandId} qrId={qr?.id} scans={qr?.scans} onChange={refresh} onError={setMsg} />}</td>
                    <td className="flex gap-2">
                      {app.has("branches.manage") && <button className="btn-ghost min-h-9" onClick={() => setEditing(b.id)}>تعديل</button>}
                      {app.has("directory.activate") && <button className="btn-ghost min-h-9" onClick={wrap(() => setBranchActive({ data: { id: b.id, active: !b.active } }))}>{b.active ? "إيقاف" : "تفعيل"}</button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function QrCell({ branchId, brandId, qrId, scans, onChange, onError }: { branchId: string; brandId: string; qrId?: string | undefined; scans?: number | undefined; onChange: () => void; onError: (m: string) => void }) {
  const [img, setImg] = useState<string | null>(null);
  async function show() {
    try {
      const r = await qrForBranch({ data: { branchId, origin: window.location.origin } });
      setImg(await QRCode.toDataURL(r.url, { margin: 1, width: 600, errorCorrectionLevel: "H" }));
      onChange();
    } catch (e) { onError(errMessage(e)); }
  }
  function print() {
    const w = window.open("", "_blank"); if (!w || !img) return;
    w.document.write(`<html dir="rtl"><body style="text-align:center;font-family:Cairo,sans-serif"><img src="${brandLogos[brandId] ?? ""}" style="height:140px"><br><img src="${img}" style="width:420px"><p>امسح الرمز لتقديم ملاحظتك</p><script>onload=()=>print()</script></body></html>`);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-ghost min-h-9" onClick={show}>{qrId ? "عرض الرمز" : "إنشاء الرمز"}</button>
      {qrId && <span className="text-xs text-muted-foreground">زيارات: {scans}</span>}
      {img && <><img src={img} alt="رمز QR" className="h-20 w-20" /><button className="btn-ghost min-h-9" onClick={print}>طباعة</button></>}
      {qrId && <button className="btn-ghost min-h-9" onClick={async () => { try { await retireQr({ data: { id: qrId, rotate: true } }); setImg(null); onChange(); } catch (e) { onError(errMessage(e)); } }}>استبدال</button>}
      {qrId && <button className="btn-danger min-h-9" onClick={async () => { try { await retireQr({ data: { id: qrId, rotate: false } }); setImg(null); onChange(); } catch (e) { onError(errMessage(e)); } }}>إيقاف</button>}
    </div>
  );
}

function BranchForm({ brandId, id, onDone }: { brandId: string; id?: string | undefined; onDone: () => void }) {
  const app = useApp();
  const cur = app.branches.find((b) => b.id === id);
  const [f, setF] = useState({ brandId: cur?.brand_id ?? brandId, name: cur?.name ?? "", code: cur?.code ?? "", city: cur?.city ?? "", district: cur?.district ?? "", address: cur?.address ?? "", mapsUrl: cur?.maps_url ?? "", lat: cur?.latitude?.toString() ?? "", lng: cur?.longitude?.toString() ?? "" });
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid gap-3 border-t pt-3 md:grid-cols-3" onSubmit={async (e) => {
      e.preventDefault(); setMsg("");
      try {
        await saveBranch({ data: { id, fields: { brandId: f.brandId, name: f.name, code: f.code.toUpperCase(), city: f.city, district: f.district || null, address: f.address || null, mapsUrl: f.mapsUrl || "", latitude: f.lat ? Number(f.lat) : null, longitude: f.lng ? Number(f.lng) : null } } });
        onDone();
      } catch (err) { setMsg(errMessage(err)); }
    }}>
      <label className="field">العلامة<select className="input" value={f.brandId} onChange={set("brandId")}>{app.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="field">اسم الفرع<input required className="input" value={f.name} onChange={set("name")} /></label>
      <label className="field">الرمز<input required className="input ltr" value={f.code} onChange={set("code")} /></label>
      <label className="field">المدينة<input required className="input" value={f.city} onChange={set("city")} /></label>
      <label className="field">الحي<input className="input" value={f.district} onChange={set("district")} /></label>
      <label className="field">العنوان<input className="input" value={f.address} onChange={set("address")} /></label>
      <label className="field">رابط الخريطة<input className="input ltr" value={f.mapsUrl} onChange={set("mapsUrl")} /></label>
      <label className="field">خط العرض<input className="input ltr" value={f.lat} onChange={set("lat")} /></label>
      <label className="field">خط الطول<input className="input ltr" value={f.lng} onChange={set("lng")} /></label>
      {msg && <p className="error-text md:col-span-3">{msg}</p>}
      <div className="flex gap-2 md:col-span-3"><button className="btn-primary">حفظ</button><button type="button" className="btn-ghost" onClick={onDone}>إلغاء</button></div>
    </form>
  );
}
