import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApp, errMessage } from "@/lib/app-data";
import { createStaff, listStaff, updateStaff } from "@/functions/admin.functions";
import { assignableRoles, financeDuties, financeDutyLabels, roleLabels } from "@/lib/domain";
import { PageHead } from "@/components/crm";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "المستخدمون — أليز غلوب" }, { name: "description", content: "إدارة حسابات الموظفين والأدوار والنطاقات" }, { property: "og:title", content: "المستخدمون" }, { property: "og:description", content: "إدارة حسابات الموظفين والأدوار والنطاقات" }] }),
  component: Users,
});

type Form = { userId?: string; email: string; password: string; name: string; role: string; financeDuty: string; brandIds: string[]; branchIds: string[]; enabled: boolean };
const empty: Form = { email: "", password: "", name: "", role: "AGENT", financeDuty: "NONE", brandIds: [], branchIds: [], enabled: true };

function Users() {
  const app = useApp();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["staff"], queryFn: () => listStaff() });
  const [f, setF] = useState<Form | null>(null);
  const [msg, setMsg] = useState("");
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <>
      <PageHead title="المستخدمون"><button className="btn-primary" onClick={() => { setF({ ...empty }); setMsg(""); }}>موظف جديد</button></PageHead>
      {f && (
        <form className="panel mb-4 grid gap-3 md:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); setMsg("");
          try {
            const base = { name: f.name, role: f.role as never, financeDuty: f.financeDuty as never, brandIds: f.brandIds, branchIds: f.branchIds };
            if (f.userId) await updateStaff({ data: { ...base, userId: f.userId, enabled: f.enabled } });
            else await createStaff({ data: { ...base, email: f.email, password: f.password } });
            setF(null); qc.invalidateQueries();
          } catch (err) { setMsg(errMessage(err)); }
        }}>
          <label className="field">الاسم<input required className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          {!f.userId && <label className="field">البريد<input required type="email" className="input ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>}
          {!f.userId && <label className="field">كلمة مرور مؤقتة (12+)<input required minLength={12} type="password" autoComplete="new-password" className="input ltr" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>}
          <label className="field">الدور<select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{assignableRoles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}</select></label>
          <label className="field">المهمة المالية<select className="input" value={f.financeDuty} onChange={(e) => setF({ ...f, financeDuty: e.target.value })}>{financeDuties.map((d) => <option key={d} value={d}>{financeDutyLabels[d]}</option>)}</select></label>
          {f.userId && <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> الحساب مفعل</label>}
          <fieldset className="md:col-span-3"><legend className="field">العلامات</legend>
            <div className="flex flex-wrap gap-3">{app.brands.map((b) => <label key={b.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.brandIds.includes(b.id)} onChange={() => setF({ ...f, brandIds: toggle(f.brandIds, b.id) })} />{b.name}</label>)}</div>
          </fieldset>
          <fieldset className="md:col-span-3"><legend className="field">تقييد بفروع (اختياري؛ بدون تحديد = كل فروع العلامات)</legend>
            <div className="flex flex-wrap gap-3">{app.branches.filter((b) => f.brandIds.includes(b.brand_id)).map((b) => <label key={b.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.branchIds.includes(b.id)} onChange={() => setF({ ...f, branchIds: toggle(f.branchIds, b.id) })} />{b.name}</label>)}</div>
          </fieldset>
          {msg && <p className="error-text md:col-span-3">{msg}</p>}
          <div className="flex gap-2 md:col-span-3"><button className="btn-primary">حفظ</button><button type="button" className="btn-ghost" onClick={() => setF(null)}>إلغاء</button></div>
          {!f.userId && <p className="text-xs text-muted-foreground md:col-span-3">لا يُرسل أي بريد دعوة. سلّم كلمة المرور المؤقتة للموظف بطريقة آمنة؛ يُطلب منه التحقق بخطوتين عند أول دخول.</p>}
        </form>
      )}
      <div className="panel overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>المهمة المالية</th><th>النطاق</th><th>الحالة</th><th></th></tr></thead>
          <tbody>{(data ?? []).map((u) => (
            <tr key={u.user_id}>
              <td className="font-bold">{u.name}</td><td className="ltr">{u.email}</td><td>{roleLabels[u.role]}</td><td>{financeDutyLabels[u.finance_duty]}</td>
              <td className="text-xs">{u.brand_ids.map(app.brandName).join("، ")}{u.branch_ids.length ? ` · ${u.branch_ids.length} فروع` : ""}</td>
              <td><span className={u.enabled ? "chip-ok" : "chip-crit"}>{u.enabled ? "مفعل" : "موقوف"}</span></td>
              <td><button className="btn-ghost min-h-9" onClick={() => setF({ userId: u.user_id, email: u.email, password: "", name: u.name, role: u.role, financeDuty: u.finance_duty, brandIds: u.brand_ids, branchIds: u.branch_ids, enabled: u.enabled })}>تعديل</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
