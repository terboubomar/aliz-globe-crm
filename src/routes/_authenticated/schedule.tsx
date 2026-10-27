import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApp, errMessage } from "@/lib/app-data";
import { cancelShift, listShifts, saveShifts } from "@/server/admin.functions";
import { PageHead } from "@/components/crm";
import { roleLabels } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({ meta: [{ title: "جدول الدوام — أليز غلوب" }, { name: "description", content: "جدول دوام مشترك لكل العلامات" }, { property: "og:title", content: "جدول الدوام" }, { property: "og:description", content: "جدول دوام مشترك لكل العلامات" }] }),
  component: Schedule,
});

const day = 86400000;
function weekStart(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
const iso = (d: string, t: string) => new Date(`${d}T${t}:00`).toISOString();
const hm = (s: string) => new Date(s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function Schedule() {
  const app = useApp();
  const qc = useQueryClient();
  const [start, setStart] = useState(weekStart);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(+start + i * day)), [start]);
  const { data } = useQuery({ queryKey: ["shifts", +start], queryFn: () => listShifts({ data: { from: start.toISOString(), to: new Date(+start + 7 * day).toISOString() } }) });
  const canEdit = app.has("schedule");
  const people = canEdit ? app.staff : app.staff.filter((s) => s.id === app.me!.id);
  const [rows, setRows] = useState<{ userId: string; date: string; start: string; end: string; bs: string; be: string; dayOff: boolean; lead: boolean }[]>([]);
  const [msg, setMsg] = useState("");
  const blank = () => ({ userId: "", date: days[0].toISOString().slice(0, 10), start: "09:00", end: "17:00", bs: "", be: "", dayOff: false, lead: false });

  return (
    <>
      <PageHead title="جدول الدوام المشترك">
        <button className="btn-ghost" onClick={() => setStart(new Date(+start - 7 * day))}>الأسبوع السابق</button>
        <button className="btn-ghost" onClick={() => setStart(new Date(+start + 7 * day))}>الأسبوع التالي</button>
      </PageHead>
      <div className="panel overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>الموظف</th>{days.map((d) => <th key={+d}>{d.toLocaleDateString("ar-SA-u-nu-latn-ca-gregory", { weekday: "short", day: "numeric", month: "numeric" })}</th>)}</tr></thead>
          <tbody>{people.map((p) => (
            <tr key={p.id}>
              <td className="whitespace-nowrap font-bold">{p.name}<div className="text-xs font-normal text-muted-foreground">{roleLabels[p.role]}</div></td>
              {days.map((d) => {
                const s = (data ?? []).filter((x) => x.user_id === p.id && new Date(x.start_at) < new Date(+d + day) && new Date(x.end_at) > d);
                return <td key={+d} className="min-w-28">{s.map((x) => (
                  <div key={x.id} className="mb-1 rounded-sm bg-muted px-2 py-1 text-xs">
                    {x.day_off ? "إجازة" : <span className="ltr">{hm(x.start_at)}–{hm(x.end_at)}</span>}
                    {x.break_start && <div className="text-muted-foreground">استراحة <span className="ltr">{hm(x.break_start)}–{hm(x.break_end!)}</span></div>}
                    {x.lead && <span className="chip-ok">قائد</span>}
                    {canEdit && <button className="mr-1 text-destructive" aria-label="إلغاء الدوام" onClick={async () => { try { await cancelShift({ data: { id: x.id, version: x.version } }); qc.invalidateQueries({ queryKey: ["shifts"] }); } catch (e) { setMsg(errMessage(e)); } }}>×</button>}
                  </div>
                ))}</td>;
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {canEdit && (
        <section className="panel mt-4 space-y-3">
          <h2 className="font-bold">إدخال جماعي</h2>
          {rows.map((r, i) => {
            const upd = (patch: Partial<typeof r>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <select className="input" value={r.userId} onChange={(e) => upd({ userId: e.target.value })} aria-label="الموظف"><option value="">الموظف</option>{app.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                <input type="date" className="input ltr" value={r.date} onChange={(e) => upd({ date: e.target.value })} aria-label="التاريخ" />
                <input type="time" className="input ltr" value={r.start} onChange={(e) => upd({ start: e.target.value })} aria-label="البداية" disabled={r.dayOff} />
                <input type="time" className="input ltr" value={r.end} onChange={(e) => upd({ end: e.target.value })} aria-label="النهاية" disabled={r.dayOff} />
                <input type="time" className="input ltr" value={r.bs} onChange={(e) => upd({ bs: e.target.value })} aria-label="بداية الاستراحة" disabled={r.dayOff} />
                <input type="time" className="input ltr" value={r.be} onChange={(e) => upd({ be: e.target.value })} aria-label="نهاية الاستراحة" disabled={r.dayOff} />
                <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={r.dayOff} onChange={(e) => upd({ dayOff: e.target.checked })} /> إجازة</label>
                <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={r.lead} onChange={(e) => upd({ lead: e.target.checked })} /> قائد</label>
                <button className="btn-ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>حذف</button>
              </div>
            );
          })}
          {msg && <p className="error-text">{msg}</p>}
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setRows([...rows, blank()])}>إضافة سطر</button>
            {rows.length > 0 && <button className="btn-primary" onClick={async () => {
              setMsg("");
              try {
                await saveShifts({ data: { entries: rows.map((r) => r.dayOff
                  ? { userId: r.userId, start: iso(r.date, "00:00"), end: iso(r.date, "23:59"), dayOff: true, lead: false }
                  : { userId: r.userId, start: iso(r.date, r.start), end: r.end > r.start ? iso(r.date, r.end) : new Date(+new Date(iso(r.date, r.end)) + day).toISOString(), breakStart: r.bs ? iso(r.date, r.bs) : null, breakEnd: r.be ? iso(r.date, r.be) : null, lead: r.lead, dayOff: false }) } });
                setRows([]); qc.invalidateQueries({ queryKey: ["shifts"] });
              } catch (e) { setMsg(errMessage(e)); }
            }}>حفظ الكل</button>}
          </div>
        </section>
      )}
    </>
  );
}
