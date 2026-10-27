import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApp, errMessage } from "@/lib/app-data";
import { complaintAction, getComplaint } from "@/server/complaints.functions";
import { uploadEvidence } from "@/server/admin.functions";
import { requestRefund } from "@/server/refunds.functions";
import {
  can, canWorkComplaint, categoryLabels, complaintActions, escalationRoles, inScope, isComplaintParticipant,
  refundStatusLabels, supportRoles,
} from "@/lib/domain";
import { BrandLogo, PriorityChip, StageTrack, StateChip, fmt } from "@/components/crm";

export const Route = createFileRoute("/_authenticated/complaints/$id")({
  head: () => ({ meta: [{ title: "تفاصيل الشكوى — أليز غلوب" }, { name: "description", content: "متابعة الشكوى وسجلها" }, { property: "og:title", content: "تفاصيل الشكوى" }, { property: "og:description", content: "متابعة الشكوى وسجلها" }] }),
  component: Detail,
});

const eventLabels: Record<string, string> = {
  PHONE_CREATED: "تسجيل هاتفي", QR_CREATED: "استلام عبر QR", ASSIGN: "إسناد", START: "بدء العمل", RESOLVE: "توثيق الحل",
  CONTACT_RECORDED: "تواصل مع العميل", CUSTOMER_CONFIRMED: "تأكيد العميل", CLOSE: "إغلاق", REOPEN: "إعادة فتح",
  ESCALATE: "تصعيد", ESCALATION_ROUTED: "توجيه التصعيد", COMMENT: "ملاحظة", FOLLOWUP_SATISFIED: "العميل راضٍ",
  FOLLOWUP_UNREACHABLE: "تعذر الوصول للعميل", FOLLOWUP_UNRESOLVED: "المشكلة مستمرة",
};

function Detail() {
  const { id } = Route.useParams();
  const app = useApp();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["ticket", id], queryFn: () => getComplaint({ data: { id } }) });
  const [action, setAction] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [owner, setOwner] = useState("");
  const [outcome, setOutcome] = useState("SATISFIED");
  const [brief, setBrief] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (isLoading) return <p className="text-muted-foreground">جارٍ التحميل…</p>;
  if (!data) return <p>الشكوى غير موجودة ضمن نطاقك. <Link to="/complaints" className="text-primary">العودة</Link></p>;
  const t = data.ticket;
  const me = app.me!;
  const scope = { brandId: t.brandId, branchId: t.branchId };
  const available = complaintActions.filter((a) => {
    if (!a.from.includes(t.state as never) || !can(me, a.perm)) return false;
    if (a.id === "comment" && me.role === "AGENT" && !isComplaintParticipant(me, t)) return false;
    if (["start", "resolve", "escalate"].includes(a.id) && !canWorkComplaint(me, { ...scope, resolutionOwner: t.resolutionOwner, escalated: t.escalated })) return false;
    if (a.id === "followup" && me.role === "AGENT" && t.communicationsOwner !== me.id) return false;
    if (a.id === "followup" && !t.actionCompletedAt) return false;
    return true;
  });
  const candidates = app.staff.filter((s) =>
    action === "assign" ? supportRoles.includes(s.role) && inScope(s, scope)
      : escalationRoles.includes(s.role) && s.id !== me.id && inScope(s, scope));

  async function run() {
    setBusy(true); setMsg("");
    try {
      await complaintAction({ data: { id, action: action!, input: {
        version: t.version, note, resolutionOwner: owner || undefined,
        outcome: action === "followup" ? outcome : undefined, branchBrief: brief || undefined,
      } } });
      setAction(null); setNote(""); setOwner(""); setBrief("");
      qc.invalidateQueries({ queryKey: ["ticket", id] });
    } catch (e) { setMsg(errMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div className="panel space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <BrandLogo id={t.brandId} size={40} />
            <h1 className="page-title ltr">{t.number}</h1>
            <PriorityChip p={t.priority} /><StateChip state={t.state} />
            {t.escalated && <span className="chip-crit">مصعّدة</span>}
          </div>
          <StageTrack t={t} />
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Info k="العلامة" v={app.brandName(t.brandId)} />
            <Info k="الفرع (سياق فقط)" v={t.branchId ? app.branchName(t.branchId) : `غير معروف: ${t.unknownReason ?? ""}`} />
            <Info k="التصنيف" v={categoryLabels[t.category]} />
            <Info k="المصدر" v={t.source === "PUBLIC_QR" ? "QR" : "الهاتف"} />
            <Info k="وقت الاستقبال" v={fmt(t.receivedAt)} />
            <Info k="مسؤول المعالجة" v={app.staffName(t.resolutionOwner)} />
            <Info k="مسؤول التواصل" v={app.staffName(t.communicationsOwner)} />
            <Info k="رقم الطلب" v={[t.platform, t.externalOrder].filter(Boolean).join(" · ") || "—"} />
          </dl>
          <div><h2 className="font-bold">الوصف</h2><p className="whitespace-pre-wrap">{t.description}</p></div>
          {t.customer && <p className="text-sm">العميل: {t.customer.name || "—"} · <span className="ltr">{t.customer.phone || "—"}</span></p>}
          {t.branchBrief && <p className="text-sm"><b>موجز التصعيد:</b> {t.branchBrief}</p>}
        </div>

        <div className="panel">
          <h2 className="mb-2 font-bold">السجل (غير قابل للتعديل)</h2>
          <ol className="space-y-2">
            {data.events.map((e) => (
              <li key={e.id} className="border-r-2 border-secondary pr-3 text-sm">
                <b>{eventLabels[e.type] ?? e.type}</b> · {app.staffName(e.actor)} · <span className="text-muted-foreground">{fmt(e.createdAt)}</span>
                {e.note && <p className="text-muted-foreground">{e.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="panel space-y-3">
          <h2 className="font-bold">الإجراءات</h2>
          {available.length === 0 && <p className="text-sm text-muted-foreground">لا توجد إجراءات متاحة لك؛ يمكنك العرض فقط.</p>}
          <div className="flex flex-wrap gap-2">
            {available.map((a) => <button key={a.id} className={action === a.id ? "btn-primary" : "btn-ghost"} onClick={() => { setAction(a.id); setMsg(""); }}>{a.label}</button>)}
          </div>
          {action && (
            <div className="space-y-3 border-t pt-3">
              {(action === "assign" || action === "escalate" || (action === "followup" && outcome === "UNRESOLVED")) && (
                <label className="field">{action === "assign" ? "موظف الدعم" : "المشرف / العمليات"}
                  <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
                    <option value="">اختر</option>
                    {candidates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
              {action === "followup" && (
                <label className="field">نتيجة التواصل
                  <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                    <option value="SATISFIED">تم الحل والعميل راضٍ</option>
                    <option value="UNREACHABLE">تعذر الوصول</option>
                    <option value="UNRESOLVED">المشكلة مستمرة — تصعيد</option>
                  </select>
                </label>
              )}
              {(action === "escalate" || (action === "followup" && outcome === "UNRESOLVED")) && (
                <label className="field">موجز التصعيد (بدون بيانات شخصية)
                  <textarea className="input min-h-20 py-2" value={brief} onChange={(e) => setBrief(e.target.value)} />
                </label>
              )}
              <label className="field">ملاحظة
                <textarea className="input min-h-20 py-2" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              {msg && <p role="alert" className="error-text">{msg}</p>}
              <button className="btn-primary w-full" disabled={busy} onClick={run}>تأكيد</button>
            </div>
          )}
        </div>
        <RefundBox ticketId={id} refunds={data.refunds} canRequest={app.has("refund.request")} />
        <EvidenceBox ticketId={id} files={data.attachments} canAttach={app.has("evidence.attach")} />
      </aside>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-xs font-bold text-muted-foreground">{k}</dt><dd>{v}</dd></div>;
}

function RefundBox({ ticketId, refunds, canRequest }: { ticketId: string; refunds: { id: string; number: string; status: string; kind: string }[]; canRequest: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"REFUND" | "CANCELLATION">("REFUND");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <div className="panel space-y-2">
      <h2 className="font-bold">الطلبات المالية المرتبطة</h2>
      {refunds.length === 0 && <p className="text-sm text-muted-foreground">لا يوجد.</p>}
      {refunds.map((r) => <p key={r.id} className="text-sm"><Link to="/refunds" className="ltr text-primary">{r.number}</Link> · {refundStatusLabels[r.status]}</p>)}
      {canRequest && !open && <button className="btn-ghost w-full" onClick={() => setOpen(true)}>طلب استرداد / إلغاء</button>}
      {open && (
        <div className="space-y-2">
          <select className="input w-full" value={kind} onChange={(e) => setKind(e.target.value as never)}>
            <option value="REFUND">استرداد</option><option value="CANCELLATION">إلغاء</option>
          </select>
          <input className="input w-full ltr" inputMode="numeric" placeholder="المبلغ بالهللة (اختياري)" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
          <textarea className="input min-h-16 w-full py-2" placeholder="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
          {msg && <p className="error-text">{msg}</p>}
          <button className="btn-primary w-full" onClick={async () => {
            try { await requestRefund({ data: { ticketId, kind, reason, amountMinor: amount ? Number(amount) : undefined } }); setOpen(false); qc.invalidateQueries(); }
            catch (e) { setMsg(errMessage(e)); }
          }}>إرسال الطلب</button>
        </div>
      )}
    </div>
  );
}

export function EvidenceBox({ ticketId, refundId, files, canAttach }: { ticketId?: string; refundId?: string; files: { id: string; mime: string; size: number; status: string }[]; canAttach: boolean }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  return (
    <div className="panel space-y-2">
      <h2 className="font-bold">الأدلة الخاصة</h2>
      {files.length === 0 && <p className="text-sm text-muted-foreground">لا توجد ملفات.</p>}
      {files.map((f) => <p key={f.id} className="text-sm">{f.mime} · {(f.size / 1024).toFixed(0)}KB · <span className={f.status === "CLEAN" ? "chip-ok" : "chip-warn"}>{f.status === "PENDING_SCAN" ? "بانتظار الفحص" : f.status}</span></p>)}
      {canAttach && (
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" aria-label="إرفاق ملف" className="text-sm" onChange={async (e) => {
          const file = e.target.files?.[0]; if (!file) return;
          setMsg("");
          if (file.size > 8 * 1024 * 1024) return setMsg("الحد الأقصى 8MB");
          const buf = new Uint8Array(await file.arrayBuffer());
          let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          try { await uploadEvidence({ data: { ticketId, refundId, mime: file.type, base64: btoa(bin) } }); qc.invalidateQueries(); }
          catch (err) { setMsg(errMessage(err)); }
        }} />
      )}
      {msg && <p className="error-text">{msg}</p>}
    </div>
  );
}
