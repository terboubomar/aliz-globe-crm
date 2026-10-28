import { BulkScheduleModal } from "./bulk-schedule-modal";
import { useState, FormEvent } from "react";
import { Plus, ChevronRight, ChevronLeft, Clock, Search } from "lucide-react";
import { Data, Shift, n, date, roleNames } from "./types";
import { Modal, Field, Submit, Empty } from "./ui";
import {
  addDays,
  intersects,
  localInput,
  localISO,
  netHours,
  riyadhDay,
  riyadhISO,
  weekDays,
} from "./schedule-time";
const clock = (v: string) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Riyadh",
  }).format(new Date(v));
const dayLabel = (v: string, weekday = false) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    calendar: "gregory",
    day: "numeric",
    month: "short",
    ...(weekday ? { weekday: "short" as const } : {}),
    timeZone: "Asia/Riyadh",
  }).format(new Date(riyadhISO(v, "12:00")));
const staffRoles = ["AGENT", "SHIFT_LEAD", "CUSTOMER_SERVICE_MANAGER", "MARKETING_MANAGER"];
export function ScheduleWorkspace({
  data,
  mutate,
  busy,
}: {
  data: Data;
  mutate: (p: string, b?: unknown) => Promise<unknown>;
  busy: boolean;
}) {
  const [week, setWeek] = useState(0),
    [search, setSearch] = useState(""),
    [bulk, setBulk] = useState(false),
    [editing, setEditing] = useState<Shift | null | undefined>(),
    [selectedUser, setSelectedUser] = useState(""),
    [selectedDay, setSelectedDay] = useState(""),
    [dayOff, setDayOff] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [cancelling, setCancelling] = useState<Shift | null>(null);
  const manage = data.permissions.includes("schedule"),
    days = weekDays(week),
    from = riyadhISO(days[0]!),
    to = riyadhISO(addDays(days[6]!, 1)),
    today = riyadhDay(new Date());
  const staff = data.users.filter(
    (u) => staffRoles.includes(u.role) && (manage || u.id === data.me.id),
  );
  const visible = staff.filter((u) => u.name.includes(search.trim()));
  const shifts = data.shifts.filter(
    (s) =>
      !s.cancelledAt && (manage || s.userId === data.me.id) && intersects(s.start, s.end, from, to),
  );
  const allLeaves = data.leave.filter((l) => manage || l.userId === data.me.id);
  const leaves = allLeaves.filter((l) => intersects(l.start, l.end, from, to));
  const open = (userId = staff[0]?.id ?? "", day = days.includes(today) ? today : days[0]!) => {
    setError("");
    setSelectedUser(userId);
    setSelectedDay(day);
    setDayOff(false);
    setEditing(null);
  };
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await mutate(editing ? `shifts/${editing.id}/update` : "shifts", {
        userId: editing?.userId ?? values["userId"],
        dayOff,
        start: dayOff ? riyadhISO(values["day"] ?? "") : localISO(values["start"] ?? ""),
        end: dayOff ? riyadhISO(addDays(values["day"] ?? "", 1)) : localISO(values["end"] ?? ""),
        breakStart: !dayOff && values["breakStart"] ? localISO(values["breakStart"] ?? "") : null,
        breakEnd: !dayOff && values["breakEnd"] ? localISO(values["breakEnd"] ?? "") : null,
        lead: !dayOff && values["lead"] === "on",
        ...(editing ? { version: editing.version } : {}),
      });
      setEditing(undefined);
      setNotice(dayOff ? "تم حفظ يوم الراحة." : "تم حفظ الوردية.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <section className="panel staff-schedule">
        <div className="panel-head">
          <div>
            <h2>{manage ? "جدول فريق الدعم" : "جدولي"}</h2>
            <span className="badge neutral">جميع العلامات</span>
          </div>
          <div className="table-tools">
            {manage && (
              <button
                className="secondary"
                disabled={!staff.length || busy}
                onClick={() => {
                  setError("");
                  setBulk(true);
                }}
              >
                جدولة جماعية
              </button>
            )}
            {manage && (
              <button className="primary" disabled={!staff.length || busy} onClick={() => open()}>
                <Plus size={17} /> إضافة وردية
              </button>
            )}
          </div>
        </div>
        <div className="schedule-toolbar">
          <div className="schedule-week-nav">
            <button
              className="icon-btn"
              aria-label="الأسبوع السابق"
              onClick={() => setWeek(week - 1)}
            >
              <ChevronRight size={19} />
            </button>
            <b>
              {dayLabel(days[0]!)} – {dayLabel(days[6]!)}
            </b>
            <button
              className="icon-btn"
              aria-label="الأسبوع التالي"
              onClick={() => setWeek(week + 1)}
            >
              <ChevronLeft size={19} />
            </button>
            <button className="secondary" onClick={() => setWeek(0)} disabled={week === 0}>
              هذا الأسبوع
            </button>
          </div>
          <span className="schedule-zone">
            <Clock size={15} /> توقيت الرياض
          </span>
          {manage && (
            <label className="qr-search">
              <Search size={17} />
              <input
                aria-label="البحث عن موظف"
                placeholder="ابحث عن موظف"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="schedule-totals">
          <span>
            <b>{n(staff.filter((u) => shifts.some((s) => s.userId === u.id)).length)}</b> موظفون
            مجدولون
          </span>
          <span>
            <b>{n(shifts.filter((s) => !s.dayOff).length)}</b> ورديات
          </span>
          <span>
            <b>{n(Math.round(netHours(shifts, from, to) * 10) / 10)}</b> ساعات عمل
          </span>
        </div>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {!visible.length ? (
          <Empty title="لا يوجد موظفون مطابقون" />
        ) : (
          <div className="table-scroll">
            <table className="schedule-table shared-schedule-table">
              <thead>
                <tr>
                  <th>الموظف</th>
                  {days.map((day) => (
                    <th key={day} className={day === today ? "schedule-today" : ""}>
                      {dayLabel(day, true)}
                    </th>
                  ))}
                  <th>الساعات</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <b>{user.name}</b>
                      <small className="schedule-staff-role">{roleNames[user.role]}</small>
                    </td>
                    {days.map((day) => {
                      const dayFrom = riyadhISO(day),
                        dayTo = riyadhISO(addDays(day, 1)),
                        own = shifts.filter(
                          (s) => s.userId === user.id && intersects(s.start, s.end, dayFrom, dayTo),
                        ),
                        leave = leaves.find(
                          (l) =>
                            l.userId === user.id &&
                            l.status === "APPROVED" &&
                            intersects(l.start, l.end, dayFrom, dayTo),
                        );
                      return (
                        <td key={day} className={day === today ? "schedule-today" : ""}>
                          {leave && <span className="badge amber">إجازة</span>}
                          {own.map((shift) => (
                            <button
                              type="button"
                              className={
                                "shift-block schedule-shift" +
                                (shift.dayOff ? " schedule-day-off" : "")
                              }
                              key={shift.id}
                              disabled={!manage}
                              onClick={() => {
                                setError("");
                                setDayOff(!!shift.dayOff);
                                setEditing(shift);
                              }}
                              aria-label={`${shift.dayOff ? "تعديل يوم راحة" : "تعديل وردية"} ${user.name} ${day}`}
                            >
                              {shift.dayOff ? (
                                <b>يوم راحة</b>
                              ) : (
                                <>
                                  <b>
                                    {clock(shift.start)} – {clock(shift.end)}
                                  </b>
                                  {riyadhDay(shift.start) !== riyadhDay(shift.end) && (
                                    <small>
                                      {riyadhDay(shift.start) === day
                                        ? "تنتهي في اليوم التالي"
                                        : "بدأت في اليوم السابق"}
                                    </small>
                                  )}
                                  {shift.lead && <small>قائد الوردية</small>}
                                  {shift.breakStart && shift.breakEnd && (
                                    <small>
                                      استراحة {clock(shift.breakStart)} – {clock(shift.breakEnd)}
                                    </small>
                                  )}
                                </>
                              )}
                            </button>
                          ))}
                          {!own.length && !leave && <span className="unplanned">غير مجدول</span>}
                          {manage && !leave && !own.some((s) => s.dayOff) && (
                            <button
                              className="schedule-add"
                              aria-label={`إضافة وردية ${user.name} ${day}`}
                              onClick={() => open(user.id, day)}
                            >
                              <Plus size={14} />
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td>
                      <b>
                        {n(
                          Math.round(
                            netHours(
                              shifts.filter((s) => s.userId === user.id),
                              from,
                              to,
                            ) * 10,
                          ) / 10,
                        )}
                      </b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>الإجازات</h2>
        </div>
        <div className="padded">
          <form
            className="schedule-leave-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              const form = e.currentTarget,
                v = Object.fromEntries(new FormData(form)) as Record<string, string>;
              try {
                await mutate("leave", {
                  start: riyadhISO(v["start"] ?? ""),
                  end: riyadhISO(addDays(v["end"] ?? "", 1)),
                });
                form.reset();
                setNotice("تم إرسال طلب الإجازة.");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Field label="من">
              <input name="start" type="date" required />
            </Field>
            <Field label="إلى">
              <input name="end" type="date" required />
            </Field>
            <Submit busy={busy}>طلب إجازة لحسابي</Submit>
          </form>
          {!allLeaves.length && <Empty title="لا توجد طلبات إجازة" />}
          {allLeaves.map((l) => (
            <div className="task-row" key={l.id}>
              <b>{data.users.find((u) => u.id === l.userId)?.name ?? data.me.name}</b>
              <span>
                {date(l.start)} – {date(l.end)}
              </span>
              <span className="badge">
                {l.status === "REQUESTED"
                  ? "بانتظار الموافقة"
                  : l.status === "APPROVED"
                    ? "معتمدة"
                    : "مرفوضة"}
              </span>
              {manage && l.status === "REQUESTED" && (
                <div className="table-tools">
                  {["approve", "reject"].map((action) => (
                    <button
                      key={action}
                      disabled={busy}
                      className="secondary"
                      onClick={async () => {
                        setError("");
                        try {
                          await mutate(`leave/${l.id}/${action}`, {});
                          setNotice("تم تحديث طلب الإجازة.");
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      {action === "approve" ? "اعتماد" : "رفض"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      {error && editing === undefined && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {bulk && (
        <BulkScheduleModal
          staff={staff}
          days={days}
          mutate={mutate}
          busy={busy}
          onClose={() => setBulk(false)}
          onSaved={(count) => {
            setBulk(false);
            setNotice(`تم حفظ ${n(count)} سجلات في الجدول.`);
          }}
        />
      )}
      {editing !== undefined && (
        <Modal
          title={
            editing ? (dayOff ? "تعديل يوم الراحة" : "تعديل الوردية") : "إضافة وردية أو يوم راحة"
          }
          onClose={() => !busy && setEditing(undefined)}
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <Field label="الموظف" full>
                <select
                  name="userId"
                  required
                  defaultValue={editing?.userId ?? selectedUser}
                  disabled={!!editing}
                >
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="نوع الجدولة" full>
                <select
                  aria-label="نوع الجدولة"
                  value={dayOff ? "off" : "work"}
                  onChange={(e) => {
                    setDayOff(e.target.value === "off");
                    setError("");
                  }}
                >
                  <option value="work">وردية عمل</option>
                  <option value="off">يوم راحة</option>
                </select>
              </Field>
              {dayOff ? (
                <Field label="تاريخ يوم الراحة" full>
                  <input
                    name="day"
                    type="date"
                    required
                    defaultValue={editing ? riyadhDay(editing.start) : selectedDay}
                  />
                </Field>
              ) : (
                <>
                  <Field label="بداية الوردية">
                    <input
                      name="start"
                      type="datetime-local"
                      required
                      defaultValue={editing ? localInput(editing.start) : `${selectedDay}T09:00`}
                    />
                  </Field>
                  <Field label="نهاية الوردية">
                    <input
                      name="end"
                      type="datetime-local"
                      required
                      defaultValue={editing ? localInput(editing.end) : `${selectedDay}T17:00`}
                    />
                  </Field>
                  <Field label="بداية الاستراحة (اختياري)">
                    <input
                      name="breakStart"
                      type="datetime-local"
                      defaultValue={editing?.breakStart ? localInput(editing.breakStart) : ""}
                    />
                  </Field>
                  <Field label="نهاية الاستراحة (اختياري)">
                    <input
                      name="breakEnd"
                      type="datetime-local"
                      defaultValue={editing?.breakEnd ? localInput(editing.breakEnd) : ""}
                    />
                  </Field>
                  <label className="checkbox">
                    <input name="lead" type="checkbox" defaultChecked={editing?.lead} /> قائد
                    الوردية
                  </label>
                </>
              )}
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="schedule-form-actions">
              <Submit busy={busy}>{dayOff ? "حفظ يوم الراحة" : "حفظ الوردية"}</Submit>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setEditing(undefined)}
              >
                إلغاء
              </button>
              {editing && (
                <button
                  type="button"
                  className="text-btn danger"
                  disabled={busy}
                  onClick={() => {
                    setCancelling(editing);
                    setEditing(undefined);
                  }}
                >
                  {editing.dayOff ? "إلغاء يوم الراحة" : "إلغاء الوردية"}
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
      {cancelling && (
        <Modal
          title={cancelling.dayOff ? "إلغاء يوم الراحة" : "إلغاء الوردية"}
          onClose={() => !busy && setCancelling(null)}
        >
          <div className="padded">
            <p>
              {data.users.find((u) => u.id === cancelling.userId)?.name} · {date(cancelling.start)}{" "}
              – {clock(cancelling.end)}
            </p>
            <div className="table-tools">
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setError("");
                  try {
                    await mutate(`shifts/${cancelling.id}/cancel`, { version: cancelling.version });
                    setCancelling(null);
                    setNotice(cancelling.dayOff ? "تم إلغاء يوم الراحة." : "تم إلغاء الوردية.");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                تأكيد إلغاء الوردية
              </button>
              <button className="secondary" disabled={busy} onClick={() => setCancelling(null)}>
                تراجع
              </button>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
