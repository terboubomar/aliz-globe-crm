import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useApp, errMessage } from "@/lib/app-data";
import { runReport } from "@/server/admin.functions";
import { categoryLabels, stateLabels } from "@/lib/domain";
import { PageHead } from "@/components/crm";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "التقارير — أليز غلوب" }, { name: "description", content: "تقارير الشكاوى ضمن نطاقك" }, { property: "og:title", content: "التقارير" }, { property: "og:description", content: "تقارير الشكاوى ضمن نطاقك" }] }),
  component: Reports,
});

const today = () => new Date().toISOString().slice(0, 10);

function Reports() {
  const app = useApp();
  const [f, setF] = useState({ from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), to: today(), brandId: "", source: "", priority: "" });
  const input = () => ({ from: f.from, to: f.to, brandId: f.brandId || undefined, source: (f.source || undefined) as never, priority: (f.priority || undefined) as never });
  const rep = useMutation({ mutationFn: () => runReport({ data: input() }) });
  const [msg, setMsg] = useState("");
  const r = rep.data as Exclude<typeof rep.data, { csv: string }> | undefined;
  const Breakdown = ({ title, data, label }: { title: string; data: Record<string, number>; label: (k: string) => string }) => (
    <div className="panel">
      <h3 className="mb-2 font-bold">{title}</h3>
      <table className="table"><tbody>{Object.entries(data).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
        <tr key={k}><td>{label(k)}</td><td className="ltr">{v}</td><td className="ltr text-muted-foreground">{r!.total ? Math.round((v / r!.total) * 100) : 0}%</td></tr>
      ))}</tbody></table>
    </div>
  );
  return (
    <>
      <PageHead title="التقارير" />
      <form className="panel mb-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); rep.mutate(); }}>
        <label className="field">من<input type="date" className="input ltr" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="field">إلى<input type="date" className="input ltr" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label className="field">العلامة<select className="input" value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}><option value="">الكل ضمن النطاق</option>{app.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="field">المصدر<select className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="">الكل</option><option value="PUBLIC_QR">QR</option><option value="PHONE_AGENT">الهاتف</option></select></label>
        <label className="field">الأولوية<select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="">الكل</option><option>P1</option><option>P2</option><option>P3</option></select></label>
        <button className="btn-primary">عرض</button>
        <button type="button" className="btn-ghost" onClick={async () => {
          try {
            const res = (await runReport({ data: { ...input(), csv: true } })) as { csv: string };
            const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([res.csv], { type: "text/csv" })); a.download = `aliz-report-${f.from}-${f.to}.csv`; a.click();
          } catch (e) { setMsg(errMessage(e)); }
        }}>تصدير CSV</button>
      </form>
      {(rep.error || msg) && <p className="error-text">{rep.error ? errMessage(rep.error) : msg}</p>}
      {r && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            {[["الإجمالي", r.total], ["مفتوحة", r.open], ["تم الحل", r.closed], ["مصعّدة", r.escalated], ["وسيط زمن الحل (ساعة)", r.medianHours == null ? "—" : r.medianHours.toFixed(1)]].map(([k, v]) => (
              <div key={k as string} className="panel"><div className="text-xs font-bold text-muted-foreground">{k}</div><div className="text-2xl font-extrabold ltr">{v}</div></div>
            ))}
          </div>
          <p className="mb-3 text-xs text-muted-foreground">الأرقام محسوبة من كامل البيانات ضمن نطاقك للفترة المحددة (توقيت الرياض).</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Breakdown title="حسب العلامة" data={r.byBrand} label={app.brandName} />
            <Breakdown title="حسب الفرع" data={r.byBranch} label={(k) => app.branchName(k === "—" ? null : k)} />
            <Breakdown title="حسب الحالة" data={r.byState} label={(k) => stateLabels[k] ?? k} />
            <Breakdown title="حسب التصنيف" data={r.byCategory} label={(k) => categoryLabels[k] ?? k} />
          </div>
        </>
      )}
    </>
  );
}
