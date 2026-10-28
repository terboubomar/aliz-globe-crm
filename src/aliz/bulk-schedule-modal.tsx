import { useState, FormEvent } from "react";
import { User, n } from "./types";
import { Field, Modal } from "./ui";
import { bulkScheduleEntries, riyadhISO } from "./schedule-time";
export function BulkScheduleModal({
  staff,
  days,
  mutate,
  busy,
  onClose,
  onSaved,
}: {
  staff: User[];
  days: string[];
  mutate: (path: string, body?: unknown) => Promise<unknown>;
  busy: boolean;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const [users, setUsers] = useState<string[]>([]),
    [selectedDays, setDays] = useState<string[]>([]),
    [off, setOff] = useState(false),
    [error, setError] = useState("");
  const count = users.length * selectedDays.length;
  const toggle = (items: string[], id: string) =>
    items.includes(id) ? items.filter((x) => x !== id) : [...items, id];
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (!count || count > 200) return;
    const values = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      const entries = bulkScheduleEntries(users, selectedDays, {
        dayOff: off,
        start: values["start"] ?? "",
        end: values["end"] ?? "",
        breakStart: values["breakStart"],
        breakEnd: values["breakEnd"],
        lead: values["lead"] === "on",
      });
      await mutate("shifts/bulk", { entries });
      onSaved(count);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="جدولة جماعية" onClose={() => !busy && onClose()} wide>
      <form onSubmit={submit}>
        <fieldset className="schedule-bulk-group">
          <legend>الموظفون</legend>
          <button
            type="button"
            className="text-btn"
            disabled={busy}
            onClick={() => setUsers(users.length === staff.length ? [] : staff.map((u) => u.id))}
          >
            {users.length === staff.length ? "إلغاء تحديد الموظفين" : "تحديد جميع الموظفين"}
          </button>
          <div className="schedule-bulk-options">
            {staff.map((u) => (
              <label className="checkbox" key={u.id}>
                <input
                  type="checkbox"
                  checked={users.includes(u.id)}
                  disabled={busy}
                  onChange={() => setUsers(toggle(users, u.id))}
                />
                {u.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="schedule-bulk-group">
          <legend>الأيام</legend>
          <button
            type="button"
            className="text-btn"
            disabled={busy}
            onClick={() => setDays(selectedDays.length === days.length ? [] : days)}
          >
            {selectedDays.length === days.length ? "إلغاء تحديد الأيام" : "تحديد الأسبوع بالكامل"}
          </button>
          <div className="schedule-bulk-options">
            {days.map((day) => (
              <label className="checkbox" key={day}>
                <input
                  type="checkbox"
                  checked={selectedDays.includes(day)}
                  disabled={busy}
                  onChange={() => setDays(toggle(selectedDays, day))}
                />
                {new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
                  calendar: "gregory",
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: "Asia/Riyadh",
                }).format(new Date(riyadhISO(day, "12:00")))}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-grid">
          <Field label="نوع الجدولة" full>
            <select
              value={off ? "off" : "work"}
              disabled={busy}
              onChange={(e) => setOff(e.target.value === "off")}
            >
              <option value="work">وردية عمل</option>
              <option value="off">يوم راحة</option>
            </select>
          </Field>
          {!off && (
            <>
              <Field label="بداية الوردية">
                <input name="start" type="time" required defaultValue="09:00" disabled={busy} />
              </Field>
              <Field label="نهاية الوردية">
                <input name="end" type="time" required defaultValue="17:00" disabled={busy} />
              </Field>
              <Field label="بداية الاستراحة (اختياري)">
                <input name="breakStart" type="time" disabled={busy} />
              </Field>
              <Field label="نهاية الاستراحة (اختياري)">
                <input name="breakEnd" type="time" disabled={busy} />
              </Field>
              <label className="checkbox">
                <input name="lead" type="checkbox" disabled={busy} /> قائد الوردية
              </label>
            </>
          )}
        </div>
        <div className="schedule-bulk-summary" role="status">
          {n(users.length)} موظفين × {n(selectedDays.length)} أيام ={" "}
          <b>
            {n(count)} {off ? "أيام راحة" : "ورديات"}
          </b>
        </div>
        {count > 200 && (
          <p className="error" role="alert">
            الحد الأقصى 200 سجل في المرة الواحدة.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="schedule-form-actions">
          <div aria-disabled={!count || count > 200}>
            <button type="submit" className="primary" disabled={busy || !count || count > 200}>
              {busy ? "جارٍ الحفظ…" : "تطبيق على المحدد"}
            </button>
          </div>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
}
