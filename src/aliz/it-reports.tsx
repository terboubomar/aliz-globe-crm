import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Clock, Download, RefreshCw } from "lucide-react";
import { itPriorityLabels, itSummary, toItSettings, type ItTicket } from "@/lib/it";
import { itApi } from "./it-api";
import { reportDuration } from "./report-format";
import { addDays, riyadhDay } from "./schedule-time";
import { Empty, Field } from "./ui";
import { n, type Data } from "./types";

/*
 * IT report: tickets opened in a period, how fast they were started and solved,
 * and where they come from (department, branch, problem type, specialist). The
 * CSV export has one row per ticket with the department, brand, branch name,
 * code and id.
 */
export function ItReports({ data }: { data: Data }) {
  const today = riyadhDay(new Date());
  const [from, setFrom] = useState(addDays(today, -29)),
    [to, setTo] = useState(today),
    [department, setDepartment] = useState(""),
    [branchId, setBranchId] = useState(""),
    [filters, setFilters] = useState({
      from: addDays(today, -29),
      to: today,
      department: "",
      branchId: "",
    }),
    [rows, setRows] = useState<ItTicket[] | null>(null),
    [names, setNames] = useState<Record<string, string>>({}),
    [settings, setSettings] = useState(toItSettings(null)),
    [loading, setLoading] = useState(true),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const branches = data.brands.flatMap((b) => b.branches.map((r) => ({ ...r, brandName: b.name })));
  const query = {
    from: filters.from,
    to: filters.to,
    ...(filters.department ? { department: filters.department } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
  };
  const key = JSON.stringify(query);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    itApi
      .report(JSON.parse(key))
      .then((r) => {
        if (!alive) return;
        setRows(r.tickets);
        setNames(r.names);
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [key, revision]);
  // Problem type and department names come with the board settings.
  useEffect(() => {
    itApi
      .board("open")
      .then((b) => setSettings(b.settings))
      .catch(() => {});
  }, []);

  const summary = useMemo(() => (rows ? itSummary(rows) : null), [rows]);
  const branchName = (id: string) =>
    id === "NONE" ? "بدون فرع" : (branches.find((b) => b.id === id)?.name ?? "فرع");
  const personName = (id: string) => (id === "UNASSIGNED" ? "غير مسند" : (names[id] ?? "موظف"));
  const categoryName = (id: string) => settings.categories.find((c) => c.id === id)?.label ?? id;
  const departmentName = (id: string) => settings.departments.find((d) => d.id === id)?.label ?? id;

  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      const r = await itApi.report({ ...query, csv: true });
      const url = URL.createObjectURL(new Blob([r.csv ?? ""], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `aliz-it-${filters.from}-${filters.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="reports-workspace">
      <section className="panel reports-filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= 366)
              return setError("اختر فترة صحيحة لا تتجاوز 366 يوماً.");
            setFilters({ from, to, department, branchId });
            setRevision((v) => v + 1);
          }}
        >
          <Field label="من">
            <input
              type="date"
              value={from}
              max={to}
              required
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="إلى">
            <input
              type="date"
              value={to}
              min={from}
              required
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label="القسم">
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">جميع الأقسام</option>
              {settings.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الفرع">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">جميع الفروع</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.brandName} — {b.name}
                </option>
              ))}
            </select>
          </Field>
          <button className="primary" disabled={loading}>
            تطبيق الفلاتر
          </button>
        </form>
      </section>
      <div className="reports-toolbar">
        <span>حسب تاريخ فتح التذكرة · توقيت الرياض</span>
        <div className="table-tools">
          <button className="text-btn" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
            <RefreshCw size={15} /> تحديث
          </button>
          {summary && !loading && (
            <button className="secondary" disabled={exporting} onClick={exportCsv}>
              <Download size={16} /> {exporting ? "جارٍ التصدير…" : "تصدير CSV"}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <div className="panel reports-loading" role="status">
          <RefreshCw className="spin" size={22} /> جارٍ إعداد التقرير…
        </div>
      )}
      {summary && !loading && (
        <>
          <section className="reports-metrics" aria-label="مؤشرات الدعم الفني">
            {[
              { label: "التذاكر المستلمة", value: summary.total, icon: BarChart3 },
              { label: "مفتوحة", value: summary.open, icon: Clock },
              {
                label: "تم الحل",
                value: summary.confirmed + summary.awaitingConfirm,
                icon: CheckCircle2,
              },
              { label: "متأخرة الآن", value: summary.late, icon: AlertTriangle },
            ].map((m) => (
              <article key={m.label}>
                <m.icon size={20} />
                <span>{m.label}</span>
                <b>{n(m.value)}</b>
              </article>
            ))}
          </section>
          <section className="reports-outcomes">
            <div>
              <span>حُلّت ضمن المهلة</span>
              <b>{summary.onTimeRate === null ? "—" : n(summary.onTimeRate) + "٪"}</b>
              {summary.onTimeRate !== null && <progress max="100" value={summary.onTimeRate} />}
            </div>
            <div>
              <span>الوقت المعتاد حتى بدء العمل</span>
              <b>{reportDuration(summary.medianStartHours)}</b>
            </div>
            <div>
              <span>الوقت المعتاد حتى الحل</span>
              <b>{reportDuration(summary.medianFixHours)}</b>
            </div>
            <div>
              <span>بانتظار تأكيد مقدم الطلب</span>
              <b>{n(summary.awaitingConfirm)}</b>
            </div>
          </section>
          {!summary.total ? (
            <section className="panel">
              <Empty title="لا توجد تذاكر دعم فني خلال الفترة المحددة" />
            </section>
          ) : (
            <>
              <div className="report-grid">
                <Bars
                  title="حسب نوع المشكلة"
                  rows={summary.byCategory}
                  total={summary.total}
                  label={categoryName}
                />
                <Bars
                  title="حسب القسم"
                  rows={summary.byDepartment}
                  total={summary.total}
                  label={departmentName}
                />
              </div>
              <div className="report-grid">
                <Bars
                  title="حسب الأولوية"
                  rows={summary.byPriority}
                  total={summary.total}
                  label={(k) => itPriorityLabels[k as keyof typeof itPriorityLabels] ?? k}
                />
              </div>
              <Table title="حسب الفرع" rows={summary.byBranch} label={branchName} />
              <Table title="حسب المختص" rows={summary.byTechnician} label={personName} />
            </>
          )}
        </>
      )}
    </div>
  );
}

type Group = { key: string; total: number; open: number; fixed: number; late: number };

function Bars({
  title,
  rows,
  total,
  label,
}: {
  title: string;
  rows: Group[];
  total: number;
  label: (key: string) => string;
}) {
  return (
    <section className="panel reports-breakdown">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      <div className="reports-bars">
        {rows.map((r) => (
          <div key={r.key}>
            <span>{label(r.key)}</span>
            <div className="reports-bar-track">
              <i style={{ width: `${total ? (r.total / total) * 100 : 0}%` }} />
            </div>
            <b>{n(r.total)}</b>
            <small>{n(Math.round((r.total / total) * 100))}٪</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function Table({
  title,
  rows,
  label,
}: {
  title: string;
  rows: Group[];
  label: (key: string) => string;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      <div className="table-scroll">
        <table className="reports-table">
          <thead>
            <tr>
              <th>{title.replace("حسب ", "")}</th>
              <th>التذاكر</th>
              <th>مفتوحة</th>
              <th>تم الحل</th>
              <th>متأخرة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{label(r.key)}</td>
                <td>{n(r.total)}</td>
                <td>{n(r.open)}</td>
                <td>{n(r.fixed)}</td>
                <td>{r.late ? <span className="badge red">{n(r.late)}</span> : "0"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
