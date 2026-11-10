import { useEffect, useMemo, useState } from "react";
import {
  Lightbulb,
  MessageSquareWarning,
  QrCode,
  RefreshCw,
  ScanLine,
  TrendingUp,
} from "lucide-react";
import { qrStats } from "@/functions/qr-stats.functions";
import { summarizeQr, type QrStatsData } from "@/lib/qr-stats";
import { addDays, riyadhDay } from "./schedule-time";
import { Empty, Field } from "./ui";
import { n, type Data } from "./types";

/*
 * QR stats: how often the QR forms are opened, and how many visits end with a
 * complaint or a suggestion, per day, brand and branch. Visits are counted
 * when the form opens (time and code only, nothing about the visitor).
 */
type Stats = QrStatsData & { allTime: Record<string, number> };

const message = (e: unknown) => {
  const m = (e as Error)?.message ?? "";
  try {
    const list = JSON.parse(m) as { message?: string }[];
    if (Array.isArray(list) && list[0]?.message) return list[0].message;
  } catch {
    /* plain message */
  }
  return m || "تعذر تحميل إحصائيات QR";
};
const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? " ص" : " م"}`;

export function QrStatsWorkspace({ data, brand }: { data: Data; brand: string }) {
  const today = riyadhDay(new Date());
  const [preset, setPreset] = useState("30"),
    [from, setFrom] = useState(addDays(today, -29)),
    [to, setTo] = useState(today),
    [period, setPeriod] = useState({ from: addDays(today, -29), to: today }),
    [stats, setStats] = useState<Stats | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    qrStats({ data: { ...period, ...(brand !== "all" ? { brandId: brand } : {}) } })
      .then((s) => alive && setStats(s as Stats))
      .catch((e) => alive && setError(message(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [period, brand, revision]);

  const s = useMemo(
    () => (stats ? summarizeQr(stats, period.from, period.to) : null),
    [stats, period],
  );
  const brandOf = (id: string) => data.brands.find((b) => b.id === id);
  const branchName = (id: string | null) =>
    id
      ? (data.brands.flatMap((b) => b.branches).find((b) => b.id === id)?.name ?? "فرع")
      : "فرع غير محدد";
  const maxDay = Math.max(1, ...(s?.days ?? []).map((d) => Math.max(d.scans, d.sent)));
  const maxHour = Math.max(1, ...(s?.hours ?? []).map((h) => h.n));
  const allTime = Object.entries(stats?.allTime ?? {}).sort((a, b) => b[1] - a[1]);

  function pick(value: string) {
    setPreset(value);
    if (value === "custom") return;
    const f = addDays(today, 1 - Number(value));
    setFrom(f);
    setTo(today);
    setPeriod({ from: f, to: today });
  }

  return (
    <div className="reports-workspace qr-stats">
      <section className="panel reports-filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= 366)
              return setError("اختر فترة صحيحة لا تتجاوز 366 يوماً.");
            setPeriod({ from, to });
            setRevision((v) => v + 1);
          }}
        >
          <Field label="الفترة">
            <select value={preset} onChange={(e) => pick(e.target.value)}>
              <option value="7">آخر 7 أيام</option>
              <option value="30">آخر 30 يوماً</option>
              <option value="90">آخر 90 يوماً</option>
              <option value="custom">فترة مخصصة</option>
            </select>
          </Field>
          <Field label="من">
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreset("custom");
              }}
            />
          </Field>
          <Field label="إلى">
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => {
                setTo(e.target.value);
                setPreset("custom");
              }}
            />
          </Field>
          <button className="primary" disabled={loading}>
            تطبيق
          </button>
        </form>
      </section>
      <div className="reports-toolbar">
        <span>الزيارة تُحسب عند فتح نموذج QR · توقيت الرياض</span>
        <button className="text-btn" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
          <RefreshCw size={15} /> تحديث
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <div className="panel reports-loading" role="status">
          <RefreshCw className="spin" size={22} /> جارٍ التحميل…
        </div>
      )}
      {s && !loading && (
        <>
          <section className="reports-metrics" aria-label="مؤشرات QR">
            {[
              { label: "زيارات النموذج", value: n(s.scans), icon: ScanLine },
              { label: "شكاوى مرسلة", value: n(s.complaints), icon: MessageSquareWarning },
              { label: "اقتراحات مرسلة", value: n(s.suggestions), icon: Lightbulb },
              {
                label: "نسبة الإرسال من الزيارات",
                value: s.conversion === null ? "—" : n(s.conversion) + "٪",
                icon: TrendingUp,
              },
            ].map((m) => (
              <article key={m.label}>
                <m.icon size={20} />
                <span>{m.label}</span>
                <b>{m.value}</b>
              </article>
            ))}
          </section>

          {!s.scans && !s.sent ? (
            <section className="panel">
              <Empty
                title="لا توجد زيارات خلال هذه الفترة"
                detail="تبدأ الإحصائيات اليومية من الآن؛ كل فتح لنموذج QR يُحسب زيارة."
              />
            </section>
          ) : (
            <>
              <section className="panel">
                <div className="panel-head">
                  <h2>الزيارات والإرسال يومياً</h2>
                  <div className="qrs-legend">
                    <span>
                      <i className="scan" /> زيارات
                    </span>
                    <span>
                      <i className="sent" /> شكاوى واقتراحات
                    </span>
                  </div>
                </div>
                <div className="qrs-chart" role="img" aria-label="الزيارات والإرسال يومياً">
                  {s.days.map((d) => (
                    <div
                      key={d.day}
                      className="qrs-day"
                      title={`${d.day}: ${d.scans} زيارة، ${d.sent} إرسال`}
                    >
                      <div className="qrs-bars">
                        <i className="scan" style={{ height: `${(d.scans / maxDay) * 100}%` }} />
                        <i className="sent" style={{ height: `${(d.sent / maxDay) * 100}%` }} />
                      </div>
                      <small dir="ltr">{d.day.slice(8)}</small>
                    </div>
                  ))}
                </div>
              </section>

              <div className="report-grid">
                <section className="panel">
                  <div className="panel-head">
                    <h2>حسب العلامة</h2>
                  </div>
                  <div className="table-scroll">
                    <table className="reports-table">
                      <thead>
                        <tr>
                          <th>العلامة</th>
                          <th>زيارات</th>
                          <th>شكاوى</th>
                          <th>اقتراحات</th>
                          <th>نسبة الإرسال</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.brands.map((b) => (
                          <tr key={b.brandId}>
                            <td>
                              <span className="qrs-brand">
                                {brandOf(b.brandId)?.logo && (
                                  <img src={"/logos/" + brandOf(b.brandId)!.logo} alt="" />
                                )}
                                {brandOf(b.brandId)?.name ?? b.brandId}
                              </span>
                            </td>
                            <td>{n(b.scans)}</td>
                            <td>{n(b.complaints)}</td>
                            <td>{n(b.suggestions)}</td>
                            <td>{b.conversion === null ? "—" : n(b.conversion) + "٪"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-head">
                    <h2>أوقات الزيارة</h2>
                    {s.busiestHour !== null && (
                      <span className="badge neutral">الأكثر: {hourLabel(s.busiestHour)}</span>
                    )}
                  </div>
                  <div className="qrs-hours" role="img" aria-label="الزيارات حسب الساعة">
                    {s.hours.map((h) => (
                      <div key={h.hour} title={`${hourLabel(h.hour)}: ${h.n}`}>
                        <i style={{ height: `${(h.n / maxHour) * 100}%` }} />
                        {h.hour % 3 === 0 && <small>{hourLabel(h.hour)}</small>}
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <section className="panel">
                <div className="panel-head">
                  <h2>الإرسال حسب الفرع</h2>
                  <small className="hint">الفرع الذي اختاره العميل في النموذج</small>
                </div>
                {!s.branches.length ? (
                  <Empty title="لم يُرسل شيء من نماذج QR خلال هذه الفترة" />
                ) : (
                  <div className="table-scroll">
                    <table className="reports-table">
                      <thead>
                        <tr>
                          <th>الفرع</th>
                          <th>العلامة</th>
                          <th>شكاوى</th>
                          <th>اقتراحات</th>
                          <th>الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.branches.map((b) => (
                          <tr key={b.brandId + (b.branchId ?? "")}>
                            <td>{branchName(b.branchId)}</td>
                            <td>{brandOf(b.brandId)?.name ?? b.brandId}</td>
                            <td>{n(b.complaints)}</td>
                            <td>{n(b.suggestions)}</td>
                            <td>
                              <b>{n(b.total)}</b>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {allTime.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>
                  <QrCode size={18} /> إجمالي الزيارات منذ إنشاء الرموز
                </h2>
              </div>
              <div className="qrs-alltime">
                {allTime.map(([id, count]) => (
                  <div key={id}>
                    <span>{brandOf(id)?.name ?? id}</span>
                    <b>{n(count)}</b>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
