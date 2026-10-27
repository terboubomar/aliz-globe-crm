import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApp, errMessage } from "@/lib/app-data";
import { listRefunds, refundAction, requestRefund } from "@/server/refunds.functions";
import { can, refundActionLabels, refundPermission, refundStatusLabels } from "@/lib/domain";
import { PageHead, fmt } from "@/components/crm";

export const Route = createFileRoute("/_authenticated/refunds")({
  head: () => ({ meta: [{ title: "الاسترداد والإلغاء — أليز غلوب" }, { name: "description", content: "مسار مستقل لطلبات الاسترداد والإلغاء" }, { property: "og:title", content: "الاسترداد والإلغاء" }, { property: "og:description", content: "مسار مستقل لطلبات الاسترداد والإلغاء" }] }),
  component: Refunds,
});

const nextActions: Record<string, string[]> = {
  REQUESTED: ["review", "reject"], UNDER_REVIEW: ["approve", "reject"], AWAITING_EXTERNAL_EXECUTION: ["execute"],
  EXECUTED_UNVERIFIED: ["verify"], VERIFIED: ["notify"], CUSTOMER_NOTIFIED: ["complete"], REJECTED: ["resubmit"],
};

function Refunds() {
  const app = useApp();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["refunds"], queryFn: () => listRefunds() });
  const [sel, setSel] = useState<string | null>(null);
  const [act, setAct] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  const [msg, setMsg] = useState("");
  const [showNew, setShowNew] = useState(false);
  const r = data?.find((x) => x.id === sel);
  const me = app.me!;
  return (
    <>
      <PageHead title="الاسترداد والإلغاء">{app.has("refund.request") && <button className="btn-primary" onClick={() => setShowNew(!showNew)}>طلب مستقل</button>}</PageHead>
      {!app.flags.financeApproved && (
        <div className="panel mb-3 border-warning text-sm">السياسة المالية وحد الموافقة غير معتمدين بعد؛ يمكن تقديم الطلبات لكن لا تُتخذ قرارات مالية. لا يوجد أي تحويل مالي من النظام — التنفيذ خارجي ويُوثّق بمرجع وإثبات.</div>
      )}
      {showNew && <NewRefund onDone={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ["refunds"] }); }} />}
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="panel overflow-x-auto p-0">
          {isLoading && <p className="p-4">جارٍ التحميل…</p>}
          {data?.length === 0 && <p className="p-4 text-muted-foreground">لا توجد طلبات ضمن نطاقك.</p>}
          {!!data?.length && (
            <table className="table">
              <thead><tr><th>الرقم</th><th>النوع</th><th>العلامة</th><th>الطلب</th><th>المبلغ</th><th>الحالة</th><th>مقدم الطلب</th></tr></thead>
              <tbody>{data.map((x) => (
                <tr key={x.id} className={sel === x.id ? "bg-accent" : ""}>
                  <td><button className="font-bold text-primary ltr" onClick={() => { setSel(x.id); setAct(null); setMsg(""); }}>{x.number}</button></td>
                  <td>{x.kind === "REFUND" ? "استرداد" : "إلغاء"}</td>
                  <td>{app.brandName(x.brandId)}</td>
                  <td className="ltr">{x.platform} · {x.externalOrder}</td>
                  <td className="ltr">{x.amountMinor ? (x.amountMinor / 100).toFixed(2) + " SAR" : "—"}</td>
                  <td>{refundStatusLabels[x.status]}</td>
                  <td>{app.staffName(x.requester)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        {r && (
          <aside className="panel space-y-3">
            <h2 className="font-bold ltr">{r.number}</h2>
            <p className="text-sm">{r.reason}</p>
            <dl className="space-y-1 text-sm">
              <div>المعتمد: {app.staffName(r.approver)}</div><div>المنفذ: {app.staffName(r.processor)}</div>
              <div>المدقق: {app.staffName(r.verifier)}</div><div>المرجع الخارجي: <span className="ltr">{r.externalReference ?? "—"}</span></div>
            </dl>
            <div className="flex flex-wrap gap-2">
              {(nextActions[r.status] ?? []).filter((a) => can(me, refundPermission(a))).map((a) => (
                <button key={a} className={act === a ? "btn-primary" : "btn-ghost"} onClick={() => setAct(a)}>{refundActionLabels[a]}</button>
              ))}
            </div>
            {act && (
              <div className="space-y-2">
                {act === "execute" && <input className="input w-full ltr" placeholder="مرجع التنفيذ الخارجي" value={ref} onChange={(e) => setRef(e.target.value)} />}
                <textarea className="input min-h-16 w-full py-2" placeholder="ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
                {msg && <p className="error-text">{msg}</p>}
                <button className="btn-primary w-full" onClick={async () => {
                  try { await refundAction({ data: { id: r.id, action: act as never, version: r.version, note, reference: ref || undefined } }); setAct(null); setNote(""); qc.invalidateQueries({ queryKey: ["refunds"] }); }
                  catch (e) { setMsg(errMessage(e)); }
                }}>تأكيد</button>
              </div>
            )}
            <ol className="space-y-1 border-t pt-2 text-xs">
              {r.events.map((e) => <li key={e.id}>{e.type} · {app.staffName(e.actor)} · {fmt(e.createdAt)}{e.note && ` — ${e.note}`}</li>)}
            </ol>
          </aside>
        )}
      </div>
    </>
  );
}

function NewRefund({ onDone }: { onDone: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ brandId: "", branchId: "", platform: "", externalOrder: "", kind: "REFUND", reason: "", amount: "" });
  const [msg, setMsg] = useState("");
  return (
    <form className="panel mb-4 grid gap-3 md:grid-cols-3" onSubmit={async (e) => {
      e.preventDefault();
      try { await requestRefund({ data: { brandId: f.brandId, branchId: f.branchId || null, platform: f.platform, externalOrder: f.externalOrder, kind: f.kind as never, reason: f.reason, amountMinor: f.amount ? Number(f.amount) : undefined } }); onDone(); }
      catch (err) { setMsg(errMessage(err)); }
    }}>
      <label className="field">العلامة<select required className="input" value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value, branchId: "" })}><option value="">اختر</option>{app.brands.filter((b) => b.status === "ACTIVE").map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="field">الفرع<select className="input" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">—</option>{app.branches.filter((b) => b.brand_id === f.brandId && b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="field">النوع<select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="REFUND">استرداد</option><option value="CANCELLATION">إلغاء</option></select></label>
      <label className="field">المنصة<input required className="input" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} /></label>
      <label className="field">رقم الطلب<input required className="input ltr" value={f.externalOrder} onChange={(e) => setF({ ...f, externalOrder: e.target.value })} /></label>
      <label className="field">المبلغ بالهللة<input className="input ltr" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, "") })} /></label>
      <label className="field md:col-span-3">السبب<textarea required className="input min-h-16 py-2" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
      {msg && <p className="error-text md:col-span-3">{msg}</p>}
      <button className="btn-primary md:col-span-3">إرسال</button>
    </form>
  );
}
