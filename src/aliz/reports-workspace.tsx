import { useEffect, useState } from "react";
import { Download, RefreshCw, BarChart3, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { api, categories, Data, n, states, date } from "./types";
import type { ReportResult } from "./report-aggregate";
import { downloadReport } from "./adapter";
import { Empty, Field } from "./ui";
import { reportDuration } from "./report-format";
import { addDays, riyadhDay } from "./schedule-time";
type Report = ReportResult;
export function ReportsWorkspace({
  data,
  brand,
  onBrandChange,
}: {
  data: Data;
  brand: string;
  onBrandChange?: (id: string) => void;
}) {
  const today = riyadhDay(new Date());
  const [from, setFrom] = useState(addDays(today, -29)),
    [to, setTo] = useState(today),
    [source, setSource] = useState(""),
    [branch, setBranch] = useState(""),
    [priority, setPriority] = useState(""),
    [tab, setTab] = useState("overview");
  const [filters, setFilters] = useState({ from, to, source: "", branchId: "", priority: "" }),
    [report, setReport] = useState<Report | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [preset, setPreset] = useState("30");
  const branches = data.brands
    .filter((b) => brand === "all" || b.id === brand)
    .flatMap((b) => b.branches.map((r) => ({ ...r, brandName: b.name })));
  const effectiveBranch = branches.some((b) => b.id === filters.branchId) ? filters.branchId : "";
  const query = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    ...(brand !== "all" ? { brandId: brand } : {}),
    ...(effectiveBranch ? { branchId: effectiveBranch } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
  }).toString();
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError("");
    setReport(null);
    api<Report>("reports?" + query, undefined, { signal: controller.signal })
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [query, revision]);
  const range = (value: string) => {
    setPreset(value);
    if (value === "custom") return;
    const f = addDays(today, 1 - Number(value));
    setFrom(f);
    setTo(today);
    setFilters({ from: f, to: today, source, branchId: branch, priority });
  };
  return (
    <div className="reports-workspace">
      <section className="panel reports-filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= 366) {
              setError("اختر فترة صحيحة لا تتجاوز 366 يوماً.");
              return;
            }
            setFilters({ from, to, source, branchId: branch, priority });
            setRevision((value) => value + 1);
          }}
        >
          <Field label="الفترة">
            <select value={preset} onChange={(e) => range(e.target.value)}>
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
              required
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
              required
              onChange={(e) => {
                setTo(e.target.value);
                setPreset("custom");
              }}
            />
          </Field>
          <Field label="الفرع">
            <select
              value={branches.some((b) => b.id === branch) ? branch : ""}
              onChange={(e) => setBranch(e.target.value)}
            >
              <option value="">جميع الفروع</option>
              {branches.map((b) => (
                <option value={b.id} key={b.id}>
                  {b.brandName} — {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="المصدر">
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">جميع المصادر</option>
              <option value="PUBLIC_QR">QR</option>
              <option value="PHONE_AGENT">الهاتف</option>
            </select>
          </Field>
          <Field label="الأولوية">
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">جميع الأولويات</option>
              <option value="P1">P1 — حرجة</option>
              <option value="P2">P2 — مرتفعة</option>
              <option value="P3">P3 — عادية</option>
            </select>
          </Field>
          <button className="primary" disabled={loading}>
            تطبيق الفلاتر
          </button>
        </form>
      </section>
      <div className="reports-toolbar">
        <span>حسب تاريخ استقبال الشكوى · توقيت الرياض</span>
        <div className="table-tools">
          <button className="text-btn" disabled={loading} onClick={() => setRevision(revision + 1)}>
            <RefreshCw size={15} /> تحديث
          </button>
          {report && !loading && !error && (
            <a
              className="secondary"
              href="#export"
              onClick={(e) => {
                e.preventDefault();
                downloadReport(query).catch((err: Error) => setError(err.message));
              }}
            >
              <Download size={16} /> تصدير CSV
            </a>
          )}
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
          <button className="text-btn" onClick={() => setRevision(revision + 1)}>
            إعادة المحاولة
          </button>
        </div>
      )}
      {loading && (
        <div className="panel reports-loading" role="status">
          <RefreshCw className="spin" size={22} /> جارٍ إعداد التقرير…
        </div>
      )}
      {report && !loading && (
        <>
          <div className="queue-tabs reports-tabs" aria-label="أقسام التقرير">
            {[
              { id: "overview", label: "نظرة عامة" },
              { id: "brands", label: "العلامات والفروع" },
              { id: "team", label: "الفريق" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? "current" : ""}
                aria-pressed={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="reports-comparison-period">
            <span>مقارنة بالفترة السابقة</span>
            <b dir="ltr">
              {report.previous.from} — {report.previous.to}
            </b>
          </div>
          <section className="reports-metrics" aria-label="مؤشرات الشكاوى">
            {[
              {
                key: "total" as const,
                label: "الشكاوى المستلمة",
                value: n(report.summary.total),
                icon: BarChart3,
              },
              {
                key: "open" as const,
                label: "غير محلولة",
                value: n(report.summary.open),
                icon: Clock,
              },
              {
                key: "closed" as const,
                label: "تم الحل",
                value: n(report.summary.closed),
                icon: CheckCircle2,
              },
              {
                key: "escalated" as const,
                label: "تصعيدات مفتوحة",
                value: n(report.summary.escalated),
                icon: AlertTriangle,
              },
            ].map((m) => (
              <article key={m.label}>
                <m.icon size={20} />
                <span>{m.label}</span>
                <b>{m.value}</b>
                <small className="reports-metric-change">
                  <span>السابق: {n(report.previous.summary[m.key])}</span>
                  <b dir="ltr">
                    {report.summary[m.key] - report.previous.summary[m.key] > 0 ? "+" : ""}
                    {n(report.summary[m.key] - report.previous.summary[m.key])}
                  </b>
                </small>
              </article>
            ))}
          </section>
          <section className="reports-outcomes">
            <div>
              <span>نسبة حل شكاوى الفترة</span>
              <b>{n(report.summary.closureRate)}٪</b>
              <progress max="100" value={report.summary.closureRate} />
            </div>
            <div>
              <span>متوسط الوقت حتى الحل</span>
              <b>{reportDuration(report.summary.avgResolutionHours)}</b>
            </div>
            <div>
              <span>بانتظار الإسناد</span>
              <b>{n(report.summary.unassigned)}</b>
            </div>
          </section>
          {!report.summary.total ? (
            <section className="panel">
              <Empty title="لا توجد شكاوى خلال الفترة المحددة" />
            </section>
          ) : (
            <>
              {tab === "overview" && (
                <>
                  <section className="panel reports-trend">
                    <div className="panel-head">
                      <h2>الشكاوى المستلمة خلال الفترة</h2>
                      <span className="badge neutral">{n(report.summary.total)} شكوى</span>
                    </div>
                    <Trend points={report.trend} previous={report.previous.trend} />
                  </section>
                  <div className="report-grid">
                    <Breakdown
                      title="حالات الشكاوى"
                      rows={report.states}
                      total={report.summary.total}
                      labels={states}
                    />
                    <Breakdown
                      title="أسباب الشكاوى"
                      rows={report.categories}
                      total={report.summary.total}
                      labels={categories}
                    />
                  </div>
                  <Breakdown
                    title="مصادر الشكاوى"
                    rows={report.sources}
                    total={report.summary.total}
                    labels={{ PUBLIC_QR: "رمز الفرع QR", PHONE_AGENT: "الهاتف" }}
                  />
                  <div className="report-grid">
                    <Breakdown
                      title="أولويات الشكاوى"
                      rows={report.priorities}
                      total={report.summary.total}
                      labels={{ P1: "P1 — حرجة", P2: "P2 — مرتفعة", P3: "P3 — عادية" }}
                    />
                    <Breakdown
                      title="أعمار الشكاوى غير المحلولة"
                      rows={report.aging
                        .map((a) => ({ key: a.key, count: a.count }))
                        .filter((a) => a.count > 0)}
                      total={report.summary.open}
                      labels={Object.fromEntries(report.aging.map((a) => [a.key, a.label]))}
                    />
                  </div>
                  <div className="reports-resolution-note">
                    <span>
                      الوقت الوسيط للحل{" "}
                      <b>{reportDuration(report.summary.medianResolutionHours)}</b>
                    </span>
                    <span>{n(report.summary.resolvedWithTime)} شكوى محلولة لها توقيت مكتمل</span>
                  </div>
                </>
              )}
              {tab === "brands" && (
                <>
                  <ReportTable
                    title="العلامات التجارية"
                    rows={report.brands}
                    onSelect={onBrandChange}
                  />
                  <ReportTable
                    title="الفروع"
                    rows={report.branches}
                    branches
                    onSelect={(id) => {
                      if (branches.some((b) => b.id === id)) {
                        setBranch(id);
                        setFilters({ ...filters, branchId: id });
                      }
                    }}
                  />
                </>
              )}
              {tab === "team" && <TeamTable rows={report.team} />}
            </>
          )}
          <small className="reports-updated">آخر تحديث: {date(report.generatedAt)}</small>
        </>
      )}
    </div>
  );
}
function Breakdown({
  title,
  rows,
  total,
  labels,
}: {
  title: string;
  rows: { key: string; count: number }[];
  total: number;
  labels: Record<string, string>;
}) {
  return (
    <section className="panel reports-breakdown">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      <div className="reports-bars">
        {!rows.length && <p className="reports-empty">لا توجد حالات</p>}
        {rows.map((r) => (
          <div key={r.key}>
            <span>{labels[r.key] ?? r.key}</span>
            <div className="reports-bar-track">
              <i style={{ width: `${total ? (r.count / total) * 100 : 0}%` }} />
            </div>
            <b>{n(r.count)}</b>
            <small>{n(Math.round((r.count / total) * 100))}٪</small>
          </div>
        ))}
      </div>
    </section>
  );
}
function ReportTable({
  title,
  rows,
  branches = false,
  onSelect,
}: {
  title: string;
  rows: Report["brands"];
  branches?: boolean;
  onSelect?: ((id: string) => void) | undefined;
}) {
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("total"),
    [limit, setLimit] = useState(15);
  const visible = rows
    .filter((r) => (r.name + " " + r.brandName).includes(search.trim()))
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, "ar")
        : sort === "open"
          ? b.open - a.open
          : sort === "rate"
            ? b.closureRate - a.closureRate
            : b.total - a.total,
    );
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <div className="table-tools">
          <input
            className="report-table-search"
            aria-label={"بحث " + title}
            placeholder="بحث"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(15);
            }}
          />
          <select
            aria-label={"ترتيب " + title}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setLimit(15);
            }}
          >
            <option value="total">الأكثر شكاوى</option>
            <option value="open">غير المحلولة</option>
            <option value="rate">نسبة الحل</option>
            <option value="name">الاسم</option>
          </select>
        </div>
      </div>
      <div className="table-scroll">
        <table className="reports-table">
          <thead>
            <tr>
              <th>{branches ? "الفرع" : "العلامة"}</th>
              <th>المستلمة</th>
              <th>غير محلولة</th>
              <th>تم الحل</th>
              <th>تصعيدات مفتوحة</th>
              <th>نسبة الحل</th>
              <th>متوسط الحل</th>
              {onSelect && <th>التفاصيل</th>}
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, limit).map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="table-brand">
                    <img src={"/logos/" + r.logo} alt="" />
                    <span>
                      <b>{r.name}</b>
                      {branches && <small>{r.brandName}</small>}
                    </span>
                  </div>
                </td>
                <td>
                  <b>{n(r.total)}</b>
                </td>
                <td>{n(r.open)}</td>
                <td>{n(r.closed)}</td>
                <td>{n(r.escalated)}</td>
                <td>{n(r.closureRate)}٪</td>
                <td>{reportDuration(r.avgResolutionHours)}</td>
                {onSelect && (
                  <td>
                    {!r.id.startsWith("UNKNOWN:") && (
                      <button
                        className="text-btn"
                        onClick={() => onSelect(r.id)}
                        aria-label={"عرض تقرير " + r.name}
                      >
                        عرض
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <Empty title="لا توجد نتائج مطابقة" />}
      {visible.length > limit && (
        <div className="padded">
          <button className="secondary" onClick={() => setLimit(limit + 15)}>
            عرض المزيد ({n(visible.length - limit)})
          </button>
        </div>
      )}
    </section>
  );
}
function TeamTable({ rows }: { rows: Report["team"] }) {
  const [search, setSearch] = useState("");
  const visible = rows.filter((r) => r.name.includes(search.trim()));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>توزيع الشكاوى حسب المسؤول الحالي</h2>
        <input
          aria-label="بحث الفريق"
          placeholder="بحث عن موظف"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="table-scroll">
        <table className="reports-table">
          <thead>
            <tr>
              <th>الموظف</th>
              <th>الشكاوى</th>
              <th>غير محلولة</th>
              <th>تم الحل</th>
              <th>تصعيدات مفتوحة</th>
              <th>متوسط الحل</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.name}</b>
                </td>
                <td>{n(r.total)}</td>
                <td>{n(r.open)}</td>
                <td>{n(r.closed)}</td>
                <td>{n(r.escalated)}</td>
                <td>{reportDuration(r.avgResolutionHours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <Empty title="لا يوجد موظفون مطابقون" />}
    </section>
  );
}
function Trend({ points, previous }: { points: Report["trend"]; previous: Report["trend"] }) {
  const max = Math.max(
      2,
      Math.ceil(
        Math.max(...points.map((p) => p.received), ...previous.map((p) => p.received)) / 2,
      ) * 2,
    ),
    width = 900,
    height = 170,
    x = (i: number) => (points.length === 1 ? 450 : 25 + (i / (points.length - 1)) * 850),
    y = (v: number) => 150 - (v / max) * 125;
  const previousLine = previous.map((p, i) => `${x(i)},${y(p.received)}`).join(" ");
  const line = points.map((p, i) => `${x(i)},${y(p.received)}`).join(" ");
  return (
    <div className="reports-trend-chart">
      <div className="report-trend-legend">
        <span>
          <i />
          الفترة الحالية
        </span>
        <span>
          <i className="previous" />
          الفترة السابقة
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="الشكاوى المستلمة يومياً">
        <title>{points.map((p) => `${p.day}: ${p.received}`).join("، ")}</title>
        {[0, 0.5, 1].map((r) => (
          <g key={r}>
            <line
              x1="25"
              x2="875"
              y1={y(max * r)}
              y2={y(max * r)}
              stroke="#eae4de"
              strokeDasharray="4 5"
            />
            <text x="4" y={y(max * r) + 4} fill="#6f645e" fontSize="12">
              {n(Math.round(max * r))}
            </text>
          </g>
        ))}
        <polygon
          points={`25,150 ${line} ${x(points.length - 1)},150`}
          fill="#b62e30"
          opacity=".06"
        />
        <polyline
          points={previousLine}
          fill="none"
          stroke="#9a928c"
          strokeWidth="2"
          strokeDasharray="5 5"
        />
        <polyline
          points={line}
          fill="none"
          stroke="#b62e30"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle
            key={p.day}
            cx={x(i)}
            cy={y(p.received)}
            r={points.length > 90 ? 1 : 3}
            fill="#b62e30"
          >
            <title>
              {p.day}: {n(p.received)}
            </title>
          </circle>
        ))}
      </svg>
      <div className="reports-trend-dates" dir="ltr">
        <span>{points[0]?.day}</span>
        <span>{points.at(-1)?.day}</span>
      </div>
    </div>
  );
}
