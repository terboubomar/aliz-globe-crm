import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { RotationPlan, Entry, ShiftPattern } from "@/lib/rotation";
import { api, n, roleNames, type User } from "./types";
import { Field, Modal } from "./ui";
import { addDays, riyadhISO, weekDays } from "./schedule-time";

type Preview = {
  entries: Entry[];
  skipped: { userId: string; day: string }[];
  coverage: { day: string; shiftId: string; count: number }[];
};
const dayName = (day: string) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    calendar: "gregory",
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Riyadh",
  }).format(new Date(riyadhISO(day, "12:00")));
const offLabel = (k: number) => (k === 1 ? "يوم واحد" : k === 2 ? "يومان" : `${n(k)} أيام`);

/** Weekly rotation: set up once, then the coming weeks fill in automatically. */
export function RotationPanel({
  staff,
  sunday,
  mutate,
  busy,
  onNotice,
}: {
  staff: User[];
  sunday: string;
  mutate: (path: string, body?: unknown) => Promise<unknown>;
  busy: boolean;
  onNotice: (text: string) => void;
}) {
  const [plan, setPlan] = useState<RotationPlan | null>(null),
    [setup, setSetup] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState("");
  const load = () =>
    api<{ plan: RotationPlan }>("schedule/rotation")
      .then((r) => setPlan(r.plan))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  const openPreview = async () => {
    setError("");
    try {
      const r = await api<{ preview: Preview | null }>("schedule/rotation?sunday=" + sunday);
      if (!r.preview) throw new Error("اختر موظفي التدوير من «إعداد التدوير» أولاً.");
      setPreview(r.preview);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const name = (id: string) => staff.find((u) => u.id === id)?.name ?? "موظف غير متاح";
  return (
    <section className="panel rotation-panel">
      <div className="panel-head">
        <h2>
          <RefreshCw size={18} /> التدوير الأسبوعي
        </h2>
        {plan && (
          <span className={"badge " + (plan.enabled ? "green" : "neutral")}>
            {plan.enabled ? "تلقائي" : "متوقف"}
          </span>
        )}
      </div>
      <div className="padded rotation-body">
        {plan && (
          <p>
            {plan.members.length
              ? `${n(plan.members.length)} موظفين يتناوبون أسبوعياً على ${plan.shifts
                  .map((s) => `${s.name} (${s.start}–${s.end})`)
                  .join(" و")}، مع ${offLabel(plan.daysOff)} راحة أسبوعياً تتغير كل أسبوع.`
              : "حدد الورديات والموظفين مرة واحدة، ويجهّز النظام جدول الأسابيع القادمة تلقائياً بالتناوب."}
            {plan.enabled &&
              ` يُجهَّز ${n(plan.weeksAhead)} ${plan.weeksAhead === 1 ? "أسبوع" : "أسابيع"} مقدماً.`}
          </p>
        )}
        <div className="table-tools">
          <button className="secondary" disabled={busy || !plan} onClick={() => setSetup(true)}>
            إعداد التدوير
          </button>
          <button
            className="primary"
            disabled={busy || !plan?.members.length}
            onClick={() => void openPreview()}
          >
            توليد الأسبوع المعروض
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      {setup && plan && (
        <RotationSetup
          plan={plan}
          staff={staff}
          busy={busy}
          onClose={() => setSetup(false)}
          onSave={async (next) => {
            const r = (await mutate("schedule/rotation", next)) as { weeks?: number };
            setSetup(false);
            await load();
            onNotice(
              r?.weeks
                ? `تم حفظ التدوير وتجهيز ${n(r.weeks)} ${r.weeks === 1 ? "أسبوع" : "أسابيع"} قادمة.`
                : "تم حفظ إعداد التدوير.",
            );
          }}
        />
      )}
      {preview && plan && (
        <Modal title="معاينة جدول الأسبوع" onClose={() => !busy && setPreview(null)} wide>
          <RotationPreview plan={plan} preview={preview} sunday={sunday} name={name} />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="schedule-form-actions">
            <button
              className="primary"
              disabled={busy || !preview.entries.length}
              onClick={async () => {
                setError("");
                try {
                  const r = (await mutate("schedule/rotation/apply", { sunday })) as {
                    saved: number;
                  };
                  setPreview(null);
                  onNotice(`تم حفظ ${n(r?.saved ?? preview.entries.length)} سجلات للأسبوع.`);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {preview.entries.length ? `حفظ ${n(preview.entries.length)} سجلات` : "لا جديد للحفظ"}
            </button>
            <button className="secondary" disabled={busy} onClick={() => setPreview(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function RotationPreview({
  plan,
  preview,
  sunday,
  name,
}: {
  plan: RotationPlan;
  preview: Preview;
  sunday: string;
  name: (id: string) => string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
  const gaps = preview.coverage.filter((c) => c.count === 0);
  const cell = (userId: string, day: string) => {
    const from = Date.parse(riyadhISO(day)),
      to = Date.parse(riyadhISO(addDays(day, 1)));
    if (preview.skipped.some((s) => s.userId === userId && s.day === day))
      return <span className="unplanned">مجدول مسبقاً</span>;
    const e = preview.entries.find(
      (x) => x.userId === userId && Date.parse(x.start) >= from && Date.parse(x.start) < to,
    );
    if (!e) return null;
    if (e.dayOff) return <span className="badge neutral">راحة</span>;
    const s = plan.shifts.find((p) => riyadhISO(day, p.start) === e.start);
    return (
      <span>
        <b>{s?.name ?? "وردية"}</b>
        {e.lead && <small> • قائد</small>}
      </span>
    );
  };
  return (
    <>
      {gaps.length > 0 && (
        <p className="notice" role="status">
          تنبيه: لا يوجد موظف في{" "}
          {gaps
            .map((g) => `${plan.shifts.find((s) => s.id === g.shiftId)?.name} ${dayName(g.day)}`)
            .join("، ")}
          . أضف موظفين أو قلّل أيام الراحة.
        </p>
      )}
      <div className="table-scroll">
        <table className="schedule-table">
          <thead>
            <tr>
              <th>الموظف</th>
              {days.map((d) => (
                <th key={d}>{dayName(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.members.map((id) => (
              <tr key={id}>
                <td>
                  <b>{name(id)}</b>
                </td>
                {days.map((d) => (
                  <td key={d}>{cell(id, d)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        الأيام المجدولة مسبقاً لا تتغير. الأسبوع القادم ينتقل كل موظف إلى الوردية التالية وتتأخر
        أيام راحته يوماً واحداً.
      </p>
    </>
  );
}

function RotationSetup({
  plan,
  staff,
  busy,
  onClose,
  onSave,
}: {
  plan: RotationPlan;
  staff: User[];
  busy: boolean;
  onClose: () => void;
  onSave: (plan: RotationPlan) => Promise<void>;
}) {
  const sundays = Array.from({ length: 5 }, (_, i) => weekDays(i)[0]!);
  const [shifts, setShifts] = useState<ShiftPattern[]>(plan.shifts),
    [members, setMembers] = useState<string[]>(
      plan.members.filter((id) => staff.some((u) => u.id === id)),
    ),
    [leads, setLeads] = useState<string[]>(plan.leads ?? []),
    [daysOff, setDaysOff] = useState(plan.daysOff),
    [weeksAhead, setWeeksAhead] = useState(plan.weeksAhead),
    [anchor, setAnchor] = useState(sundays.includes(plan.anchor) ? plan.anchor : sundays[1]!),
    [enabled, setEnabled] = useState(plan.enabled),
    [error, setError] = useState("");
  const patch = (i: number, p: Partial<ShiftPattern>) =>
    setShifts(shifts.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, by: number) => {
    const next = [...members];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    setMembers(next);
  };
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  const submit = async () => {
    setError("");
    try {
      await onSave({
        enabled,
        shifts: shifts.map((s) => ({
          ...s,
          breakStart: s.breakStart || null,
          breakEnd: s.breakEnd || null,
        })),
        members,
        leads: leads.filter((id) => members.includes(id)),
        daysOff,
        anchor,
        weeksAhead,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="إعداد التدوير الأسبوعي" onClose={() => !busy && onClose()} wide>
      <fieldset className="schedule-bulk-group">
        <legend>الورديات</legend>
        {shifts.map((s, i) => (
          <div className="form-grid rotation-shift" key={s.id}>
            <Field label="اسم الوردية">
              <input
                value={s.name}
                maxLength={40}
                onChange={(e) => patch(i, { name: e.target.value })}
              />
            </Field>
            <Field label="البداية">
              <input
                type="time"
                value={s.start}
                onChange={(e) => patch(i, { start: e.target.value })}
              />
            </Field>
            <Field label="النهاية">
              <input
                type="time"
                value={s.end}
                onChange={(e) => patch(i, { end: e.target.value })}
              />
            </Field>
            <Field label="بداية الاستراحة (اختياري)">
              <input
                type="time"
                value={s.breakStart ?? ""}
                onChange={(e) => patch(i, { breakStart: e.target.value })}
              />
            </Field>
            <Field label="نهاية الاستراحة (اختياري)">
              <input
                type="time"
                value={s.breakEnd ?? ""}
                onChange={(e) => patch(i, { breakEnd: e.target.value })}
              />
            </Field>
            <button
              type="button"
              className="icon-btn"
              aria-label={`حذف وردية ${s.name}`}
              disabled={shifts.length === 1}
              onClick={() => setShifts(shifts.filter((_, j) => j !== i))}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-btn"
          disabled={shifts.length >= 6}
          onClick={() =>
            setShifts([
              ...shifts,
              {
                id: "s" + Date.now().toString(36),
                name: "وردية جديدة",
                start: "12:00",
                end: "20:00",
              },
            ])
          }
        >
          <Plus size={15} /> إضافة وردية
        </button>
        {shifts.some((s) => s.end <= s.start) && (
          <p className="hint">الوردية التي تنتهي قبل بدايتها تمتد إلى اليوم التالي.</p>
        )}
      </fieldset>
      <fieldset className="schedule-bulk-group">
        <legend>الموظفون بالترتيب</legend>
        <p className="hint">
          الترتيب يحدد التوزيع الأول؛ بعدها ينتقل كل موظف أسبوعياً إلى الوردية التالية.
        </p>
        <div className="schedule-bulk-options">
          {staff
            .filter((u) => !members.includes(u.id))
            .map((u) => (
              <label className="checkbox" key={u.id}>
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => setMembers([...members, u.id])}
                />
                {u.name} <small>{roleNames[u.role]}</small>
              </label>
            ))}
        </div>
        <ol className="rotation-members">
          {members.map((id, i) => (
            <li key={id}>
              <b>{staff.find((u) => u.id === id)?.name}</b>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={leads.includes(id)}
                  onChange={() => setLeads(toggle(leads, id))}
                />
                قائد وردية
              </label>
              <span className="table-tools">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="أعلى"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="أسفل"
                  disabled={i === members.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="إزالة من التدوير"
                  onClick={() => setMembers(members.filter((x) => x !== id))}
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      </fieldset>
      <div className="form-grid">
        <Field label="أيام الراحة أسبوعياً">
          <select value={daysOff} onChange={(e) => setDaysOff(Number(e.target.value))}>
            {[1, 2, 3].map((k) => (
              <option key={k} value={k}>
                {offLabel(k)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="يبدأ التدوير من أسبوع">
          <select value={anchor} onChange={(e) => setAnchor(e.target.value)}>
            {sundays.map((d) => (
              <option key={d} value={d}>
                {dayName(d)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="تجهيز مقدماً">
          <select value={weeksAhead} onChange={(e) => setWeeksAhead(Number(e.target.value))}>
            {[1, 2, 3, 4].map((k) => (
              <option key={k} value={k}>
                {k === 1 ? "أسبوع واحد" : k === 2 ? "أسبوعان" : `${n(k)} أسابيع`}
              </option>
            ))}
          </select>
        </Field>
        <label className="checkbox full">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          جدولة تلقائية: يجهّز النظام الأسابيع القادمة بالتناوب دون تدخل
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="schedule-form-actions">
        <button className="primary" disabled={busy || !shifts.length} onClick={() => void submit()}>
          {busy ? "جارٍ الحفظ…" : "حفظ التدوير"}
        </button>
        <button className="secondary" disabled={busy} onClick={onClose}>
          إلغاء
        </button>
      </div>
    </Modal>
  );
}
