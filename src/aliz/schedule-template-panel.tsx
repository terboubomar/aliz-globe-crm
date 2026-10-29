import { useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import {
  DAY_NAMES,
  formatCell,
  parseTemplateCsv,
  templateFromWeek,
  templateToCsv,
  type ImportError,
  type Template,
} from "@/lib/schedule-template";
import { n, type Shift, type User } from "./types";
import { Field } from "./ui";
import { riyadhISO, weekDays } from "./schedule-time";

const weekLabel = (day: string) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    calendar: "gregory",
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Riyadh",
  }).format(new Date(riyadhISO(day, "12:00")));

function save(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Schedule template: download it, fill it in Excel, upload it. The system checks
 * every cell, previews the week, applies it, and can repeat it every week.
 */
export function ScheduleTemplatePanel({
  staff,
  shifts,
  sunday,
  mutate,
  busy,
  onNotice,
  onCreated,
}: {
  staff: User[];
  shifts: Shift[];
  sunday: string;
  mutate: (path: string, body?: unknown) => Promise<unknown>;
  busy: boolean;
  onNotice: (text: string) => void;
  onCreated?: (sunday: string) => void;
}) {
  const sundays = Array.from({ length: 5 }, (_, i) => weekDays(i)[0]!);
  const [template, setTemplate] = useState<Template | null>(null),
    [errors, setErrors] = useState<ImportError[]>([]),
    [fileName, setFileName] = useState(""),
    [anchor, setAnchor] = useState(sundays[1]!),
    [repeat, setRepeat] = useState(true),
    [rotate, setRotate] = useState(false),
    [error, setError] = useState("");
  const people = staff.map((u) => ({ id: u.id, name: u.name }));
  const name = (id: string) => staff.find((u) => u.id === id)?.name ?? "—";

  const blank = () =>
    save(
      "قالب-الجدول.csv",
      templateToCsv(
        {
          rotate: false,
          rows: staff.map((u) => ({
            userId: u.id,
            lead: u.role === "SHIFT_LEAD",
            days: Array(7).fill(null),
          })),
        },
        people,
      ),
    );
  const exportWeek = () =>
    save(`جدول-${sunday}.csv`, templateToCsv(templateFromWeek(shifts, people, sunday), people));

  const read = async (file: File | undefined) => {
    setError("");
    setTemplate(null);
    setErrors([]);
    if (!file) return;
    if (file.size > 512 * 1024) {
      setError("الملف كبير جداً؛ الحد الأقصى 512 كيلوبايت");
      return;
    }
    setFileName(file.name);
    const r = parseTemplateCsv(await file.text(), people);
    setErrors(r.errors);
    setTemplate(r.template);
  };

  const apply = async () => {
    if (!template) return;
    setError("");
    try {
      await mutate("schedule/rotation", {
        enabled: repeat,
        shifts: [],
        members: template.rows.map((r) => r.userId),
        leads: template.rows.filter((r) => r.lead).map((r) => r.userId),
        daysOff: 1,
        anchor,
        weeksAhead: 2,
        template: { ...template, rotate },
      });
      const r = (await mutate("schedule/rotation/apply", { sunday: anchor })) as { saved?: number };
      onNotice(
        `تم تطبيق القالب على أسبوع ${weekLabel(anchor)} (${n(r?.saved ?? 0)} سجلات)${
          repeat ? "، وسيتكرر تلقائياً كل أسبوع." : "."
        }`,
      );
      setTemplate(null);
      setFileName("");
      onCreated?.(anchor);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="panel schedule-template">
      <div className="panel-head">
        <h2>
          <FileSpreadsheet size={18} /> قالب الجدول (Excel)
        </h2>
      </div>
      <div className="padded">
        <p className="hint">
          نزّل القالب، واكتب في كل خانة وقت الوردية مثل <b dir="ltr">10:00-18:00</b>، أو مع
          الاستراحة <b dir="ltr">10:00-18:00 / 14:00-14:30</b>، أو <b>راحة</b> ليوم الراحة. احفظ
          الملف بصيغة CSV ثم ارفعه هنا.
        </p>
        <div className="table-tools template-actions">
          <button className="secondary" onClick={blank} disabled={!staff.length}>
            <Download size={16} /> تنزيل قالب فارغ
          </button>
          <button className="secondary" onClick={exportWeek} disabled={!staff.length}>
            <Download size={16} /> تصدير أسبوع {weekLabel(sunday)}
          </button>
          <label className="secondary template-upload">
            <Upload size={16} /> رفع قالب
            <input
              type="file"
              accept=".csv,text/csv"
              className="upload-input"
              onChange={(e) => {
                void read(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {fileName && (
          <p className="hint">
            الملف: <b>{fileName}</b>
          </p>
        )}
        {errors.length > 0 && (
          <div className="error template-errors" role="alert">
            <b>صحّح هذه الخانات ثم ارفع الملف مرة أخرى:</b>
            <ul>
              {errors.slice(0, 12).map((e, i) => (
                <li key={i}>
                  السطر {n(e.line)}
                  {e.column && ` • ${e.column}`}: {e.message}
                </li>
              ))}
              {errors.length > 12 && <li>و{n(errors.length - 12)} أخطاء أخرى…</li>}
            </ul>
          </div>
        )}
        {template && (
          <>
            <div className="table-scroll">
              <table className="schedule-table template-preview">
                <thead>
                  <tr>
                    <th>الموظف</th>
                    {DAY_NAMES.map((d) => (
                      <th key={d}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {template.rows.map((r) => (
                    <tr key={r.userId}>
                      <td>
                        <b>{name(r.userId)}</b>
                        {r.lead && <small> • قائد</small>}
                      </td>
                      {r.days.map((c, d) => (
                        <td key={d} dir="ltr" className={c?.off ? "template-off" : ""}>
                          {formatCell(c) || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-grid">
              <Field label="تطبيق ابتداءً من أسبوع">
                <select value={anchor} onChange={(e) => setAnchor(e.target.value)}>
                  {sundays.map((d) => (
                    <option key={d} value={d}>
                      {weekLabel(d)}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="checkbox full">
                <input
                  type="checkbox"
                  checked={repeat}
                  onChange={(e) => setRepeat(e.target.checked)}
                />
                تكرار القالب تلقائياً كل أسبوع
              </label>
              <label className="checkbox full">
                <input
                  type="checkbox"
                  checked={rotate}
                  onChange={(e) => setRotate(e.target.checked)}
                />
                تدوير الصفوف بين الموظفين أسبوعياً (يأخذ كل موظف جدول الموظف التالي في الأسبوع
                القادم)
              </label>
            </div>
            <div className="table-tools">
              <button className="primary" disabled={busy} onClick={() => void apply()}>
                {busy ? "جارٍ التطبيق…" : `تطبيق القالب على ${n(template.rows.length)} موظفين`}
              </button>
              <button className="secondary" disabled={busy} onClick={() => setTemplate(null)}>
                إلغاء
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="hint">الأيام المجدولة مسبقاً في الأسبوع لا تتغير عند تطبيق القالب.</p>
      </div>
    </section>
  );
}
