import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { RotationPlan } from "@/lib/rotation";
import { generate, recommendedTeam, type StaffingInput } from "@/lib/staffing";
import { api, n, roleNames, type User } from "./types";
import { Field } from "./ui";
import { riyadhISO, weekDays } from "./schedule-time";

const defaults: StaffingInput = {
  employees: 6,
  hours: 8,
  open: "12:00",
  close: "02:00",
  peakStart: "20:00",
  peakEnd: "01:00",
};
const weekLabel = (day: string) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    calendar: "gregory",
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Riyadh",
  }).format(new Date(riyadhISO(day, "12:00")));
const fmt = (x: number) => n(Math.round(x * 10) / 10);

/**
 * Schedule generator: enter the team size, hours per day, opening hours and
 * peak, and it builds the shifts and the weekly rotation (1 day off each).
 */
export function ScheduleGenerator({
  staff,
  mutate,
  busy,
  onNotice,
}: {
  staff: User[];
  mutate: (path: string, body?: unknown) => Promise<unknown>;
  busy: boolean;
  onNotice: (text: string) => void;
}) {
  const sundays = Array.from({ length: 5 }, (_, i) => weekDays(i)[0]!);
  const [input, setInput] = useState<StaffingInput>({
      ...defaults,
      employees: Math.max(1, Math.min(staff.length || defaults.employees, 40)),
    }),
    [members, setMembers] = useState<string[]>([]),
    [anchor, setAnchor] = useState(sundays[1]!),
    [auto, setAuto] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    api<{ plan: RotationPlan }>("schedule/rotation")
      .then(({ plan }) => {
        if (plan.generator) setInput(plan.generator);
        if (plan.members.length)
          setMembers(plan.members.filter((id) => staff.some((u) => u.id === id)));
      })
      .catch(() => {});
    // Load the saved inputs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const valid =
    input.employees >= 1 && input.employees <= 60 && input.hours >= 1 && input.hours <= 16;
  const result = useMemo(() => (valid ? generate(input, members) : null), [input, members, valid]);
  const recommended = useMemo(
    () => (valid ? recommendedTeam(input) : null),
    // Only depends on the hours, not on the team size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valid, input.hours, input.open, input.close, input.peakStart, input.peakEnd],
  );
  const set = (patch: Partial<StaffingInput>) => setInput({ ...input, ...patch });
  const counts = result
    ? result.shifts.map((s) => ({ ...s, people: result.slots.filter((x) => x === s.id).length }))
    : [];
  const hours = (result?.rows ?? []).filter((_, i) => i % 2 === 0);
  const max = Math.max(1, ...hours.map((r) => r.avg));
  const ready = members.length === input.employees;

  const save = async () => {
    setError("");
    if (!result || !ready) return;
    try {
      await mutate("schedule/rotation", {
        enabled: auto,
        shifts: result.shifts.map((s) => ({
          ...s,
          breakStart: s.breakStart ?? null,
          breakEnd: s.breakEnd ?? null,
        })),
        slots: result.slots,
        members,
        leads: members.filter((id) => staff.find((u) => u.id === id)?.role === "SHIFT_LEAD"),
        daysOff: 1,
        anchor,
        weeksAhead: 2,
        generator: input,
      });
      const r = (await mutate("schedule/rotation/apply", { sunday: anchor })) as { saved?: number };
      onNotice(
        `تم إنشاء الجدول: ${n(result.shifts.length)} ورديات و${n(members.length)} موظفين، وحُفظ ${n(
          r?.saved ?? 0,
        )} سجلات لأسبوع ${weekLabel(anchor)}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="panel schedule-generator">
      <div className="panel-head">
        <h2>
          <Sparkles size={18} /> إنشاء الجدول تلقائياً
        </h2>
      </div>
      <div className="padded">
        <p className="hint">
          أدخل عدد الموظفين وساعات العمل، وسيوزعهم النظام على ورديات تغطي ساعات العمل كاملة مع تركيز
          أكبر في وقت الذروة، ويوم راحة واحد أسبوعياً لكل موظف يتغير كل أسبوع.
        </p>
        <div className="form-grid generator-inputs">
          <Field label="عدد الموظفين">
            <input
              type="number"
              min={1}
              max={60}
              value={input.employees}
              onChange={(e) => set({ employees: Number(e.target.value) })}
            />
          </Field>
          <Field label="ساعات العمل للموظف يومياً">
            <input
              type="number"
              min={1}
              max={16}
              step={0.5}
              value={input.hours}
              onChange={(e) => set({ hours: Number(e.target.value) })}
            />
          </Field>
          <Field label="افتتاح الفروع">
            <input type="time" value={input.open} onChange={(e) => set({ open: e.target.value })} />
          </Field>
          <Field label="إغلاق الفروع">
            <input
              type="time"
              value={input.close}
              onChange={(e) => set({ close: e.target.value })}
            />
          </Field>
          <Field label="بداية الذروة">
            <input
              type="time"
              value={input.peakStart}
              onChange={(e) => set({ peakStart: e.target.value })}
            />
          </Field>
          <Field label="نهاية الذروة">
            <input
              type="time"
              value={input.peakEnd}
              onChange={(e) => set({ peakEnd: e.target.value })}
            />
          </Field>
        </div>
        {recommended && (
          <p className={"notice" + (input.employees < recommended ? " generator-warning" : "")}>
            {input.employees < recommended
              ? `ننصح بـ ${n(recommended)} موظفين على الأقل لتغطية كل ساعات العمل يومياً مع موظفَين على الأقل في الذروة.`
              : `العدد كافٍ: الحد الأدنى المقترح ${n(recommended)} موظفين.`}
          </p>
        )}
        {result && (
          <>
            <div className="generator-shifts">
              {counts.map((s) => (
                <div key={s.id} className="generator-shift">
                  <b>{s.name}</b>
                  <span dir="ltr">
                    {s.start} – {s.end}
                  </span>
                  <small>
                    {n(s.people)} {s.people === 1 ? "موظف" : "موظفين"}
                    {s.breakStart && ` • استراحة ${s.breakStart}`}
                  </small>
                </div>
              ))}
            </div>
            <div className="generator-coverage" aria-label="عدد الموظفين المتوقع في كل ساعة">
              {hours.map((r) => (
                <div key={r.time} className={"generator-hour" + (r.peak ? " peak" : "")}>
                  <span className="generator-bar" style={{ height: `${(r.avg / max) * 100}%` }} />
                  <b>{fmt(r.avg)}</b>
                  <small dir="ltr">{r.time.slice(0, 2)}</small>
                </div>
              ))}
            </div>
            <p className="hint">
              متوسط عدد الموظفين في كل ساعة بعد احتساب أيام الراحة. الأعمدة الملونة ساعات الذروة.
            </p>
            {result.uncovered.length > 0 && (
              <p className="error" role="alert">
                بعض الأيام تبقى فيها ساعات بلا موظف (مثل {result.uncovered.slice(0, 3).join("، ")})
                بسبب أيام الراحة. زد عدد الموظفين أو ساعات العمل.
              </p>
            )}
          </>
        )}
        <fieldset className="schedule-bulk-group">
          <legend>
            الموظفون ({n(members.length)} من {n(input.employees)})
          </legend>
          <div className="schedule-bulk-options">
            {staff.map((u) => (
              <label className="checkbox" key={u.id}>
                <input
                  type="checkbox"
                  checked={members.includes(u.id)}
                  disabled={!members.includes(u.id) && members.length >= input.employees}
                  onChange={() =>
                    setMembers(
                      members.includes(u.id)
                        ? members.filter((x) => x !== u.id)
                        : [...members, u.id],
                    )
                  }
                />
                {u.name} <small>{roleNames[u.role]}</small>
              </label>
            ))}
          </div>
          {!ready && (
            <p className="hint">
              اختر {n(input.employees)} موظفين لإنشاء الجدول، أو غيّر العدد لمعاينة خيارات أخرى.
            </p>
          )}
        </fieldset>
        <div className="form-grid">
          <Field label="يبدأ الجدول من أسبوع">
            <select value={anchor} onChange={(e) => setAnchor(e.target.value)}>
              {sundays.map((d) => (
                <option key={d} value={d}>
                  {weekLabel(d)}
                </option>
              ))}
            </select>
          </Field>
          <label className="checkbox full">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            تجهيز الأسابيع التالية تلقائياً بالتناوب
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="table-tools">
          <button
            className="primary"
            disabled={busy || !result || !ready}
            onClick={() => void save()}
          >
            {busy ? "جارٍ الإنشاء…" : "إنشاء الجدول"}
          </button>
        </div>
      </div>
    </section>
  );
}
