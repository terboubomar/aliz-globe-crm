import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Headset,
  MonitorCog,
  Plus,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { deadlineLabel } from "@/lib/dashboard";
import {
  complaintFigures,
  hubAttention,
  workFigures,
  type HubFigures,
  type HubItem,
} from "@/lib/group-dashboard";
import { itNumber, type ItTicket } from "@/lib/it";
import { maintenanceNumber, type MaintenanceRequest } from "@/lib/maintenance";
import { appLabels, appTinyLabels, canOpenView, hubSections, type AppId } from "./access";
import { DashHello } from "./dashboard-bits";
import { itApi } from "./it-api";
import { maintenanceApi } from "./maintenance-api";
import { n, subject, summaryFor, type Data } from "./types";

/*
 * The group dashboard: Customer Service, Maintenance and IT on one screen.
 * Totals across the apps, one list of what is late or urgent anywhere, and a
 * card per app with its numbers and its main actions. Each person sees only
 * the apps their permissions let them read.
 */
const icons = { cs: Headset, maintenance: Wrench, it: MonitorCog };
const openLabel: Record<AppId, string> = {
  cs: "شكاوى مفتوحة",
  maintenance: "طلبات مفتوحة",
  it: "تذاكر مفتوحة",
};
const newLabel: Record<AppId, string> = {
  cs: "شكوى هاتفية",
  maintenance: "طلب صيانة",
  it: "تذكرة دعم",
};
const mainView: Record<AppId, string> = { cs: "tickets", maintenance: "maintenance", it: "it" };
const reportView: Record<AppId, string> = {
  cs: "reports",
  maintenance: "maintenance-reports",
  it: "it-reports",
};
const newPermission: Record<AppId, string[]> = {
  cs: ["create"],
  maintenance: ["mnt.request", "mnt.assign"],
  it: ["it.request"],
};
const pendingRefund = (status: string) => !["COMPLETED", "REJECTED"].includes(status);

export function GroupDashboard({
  data,
  brand,
  onGo,
  onOpen,
  onNew,
  onRefresh,
}: {
  data: Data;
  brand: string;
  onGo: (view: string) => void;
  /** Open one complaint, maintenance request or IT ticket in its own app. */
  onOpen: (app: AppId, id: string) => void;
  onNew: (app: AppId) => void;
  /** Reload the complaints and refunds. */
  onRefresh: () => void;
}) {
  const sections = hubSections(data.permissions);
  const withMaintenance = sections.includes("maintenance"),
    withIt = sections.includes("it");
  const [maintenance, setMaintenance] = useState<MaintenanceRequest[] | null>(null),
    [it, setIt] = useState<ItTicket[] | null>(null),
    [failed, setFailed] = useState<Partial<Record<AppId, string>>>({}),
    [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const errors: Partial<Record<AppId, string>> = {};
    await Promise.all([
      withMaintenance
        ? maintenanceApi
            .board("open")
            .then((b) => setMaintenance(b.requests))
            .catch((e: Error) => (errors.maintenance = e.message))
        : null,
      withIt
        ? itApi
            .board("open")
            .then((b) => setIt(b.tickets))
            .catch((e: Error) => (errors.it = e.message))
        : null,
    ]);
    setFailed(errors);
    setLoading(false);
  }, [withMaintenance, withIt]);
  useEffect(() => {
    load();
    // Keep the screen current while it stays open.
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  const inBrand = useCallback(
    (brandId: string | null, companyWide = false) =>
      brand === "all" || (brandId ? brandId === brand : companyWide),
    [brand],
  );
  const complaints = useMemo(
    () => data.tickets.filter((t) => inBrand(t.brandId)),
    [data.tickets, inBrand],
  );
  const maintenanceRows = useMemo(
    () => (maintenance ?? []).filter((r) => inBrand(r.brandId)),
    [maintenance, inBrand],
  );
  // IT is company-wide: tickets with no branch stay in every brand's view.
  const itRows = useMemo(() => (it ?? []).filter((r) => inBrand(r.brandId, true)), [it, inBrand]);

  const figures = useMemo(() => {
    const out: Partial<Record<AppId, HubFigures | null>> = {};
    if (sections.includes("cs")) {
      const loaded = complaintFigures(complaints);
      // Exact totals from the server when it sent them (the loaded list is capped).
      const exact = summaryFor(data.ticketSummary, brand);
      out.cs = exact
        ? { ...loaded, open: exact.active, late: exact.late, urgent: exact.urgent }
        : loaded;
    }
    if (withMaintenance) out.maintenance = maintenance ? workFigures(maintenanceRows) : null;
    if (withIt) out.it = it ? workFigures(itRows) : null;
    return out;
  }, [
    sections,
    complaints,
    data.ticketSummary,
    brand,
    withMaintenance,
    withIt,
    maintenance,
    it,
    maintenanceRows,
    itRows,
  ]);

  const attention = useMemo(
    () =>
      hubAttention({
        complaints: sections.includes("cs")
          ? complaints.map((t) => ({ ...t, title: subject(t) }))
          : [],
        maintenance: maintenanceRows,
        it: itRows,
        maintenanceNumber,
        itNumber,
      }),
    [sections, complaints, maintenanceRows, itRows],
  );

  const total = (key: keyof HubFigures) =>
    sections.reduce((sum, app) => sum + (figures[app]?.[key] ?? 0), 0);
  const branchName = (id: string | null) =>
    id ? data.brands.flatMap((b) => b.branches).find((b) => b.id === id)?.name : undefined;
  const brandName = (id: string | null) => data.brands.find((b) => b.id === id)?.name;
  const place = (i: HubItem) =>
    [brandName(i.brandId), branchName(i.branchId)].filter(Boolean).join(" — ") ||
    (i.app === "it" ? "على مستوى الشركة" : "فرع غير محدد");
  const can = (view: string) => canOpenView(view, data.permissions, data.me.role);
  const refunds = can("refunds")
    ? data.refunds.filter((r) => inBrand(r.brandId) && pendingRefund(r.status)).length
    : null;
  const names = sections.map((app) => appLabels[app]).join(" و");

  return (
    <div className="hub">
      <div className="hub-head">
        <DashHello name={data.me.name} line={names + " في شاشة واحدة."} />
        <button
          type="button"
          className="text-btn"
          disabled={loading}
          onClick={() => {
            onRefresh();
            load();
          }}
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} /> تحديث
        </button>
      </div>

      <section className="hub-totals" aria-label="إجمالي كل الأقسام">
        {(
          [
            { key: "open", label: "مفتوحة في كل الأقسام", icon: Clock, tone: "burgundy" },
            { key: "late", label: "متأخرة عن المهلة", icon: AlertTriangle, tone: "red" },
            { key: "urgent", label: "عاجلة", icon: AlertTriangle, tone: "amber" },
            { key: "unassigned", label: "بدون إسناد", icon: CheckCircle2, tone: "blue" },
          ] as const
        ).map((k) => (
          <article key={k.key} className={"hub-total " + k.tone}>
            <span className="hub-total-icon" aria-hidden="true">
              <k.icon size={19} />
            </span>
            <b>{n(total(k.key))}</b>
            <span>{k.label}</span>
            <small>
              {sections
                .map((app) => appTinyLabels[app] + " " + n(figures[app]?.[k.key] ?? 0))
                .join(" · ")}
            </small>
          </article>
        ))}
      </section>

      <section className="hub-attention" aria-labelledby="hub-attention-title">
        <div className="hub-attention-head">
          <AlertTriangle size={18} aria-hidden="true" />
          <h2 id="hub-attention-title">تحتاج انتباهك الآن</h2>
          {attention.length > 0 && <span>{n(attention.length)}</span>}
        </div>
        {attention.length ? (
          <div className="hub-attention-list">
            {attention.slice(0, 8).map((i) => (
              <button key={i.app + i.id} type="button" onClick={() => onOpen(i.app, i.id)}>
                <span className={"hub-app-tag " + i.app}>{appTinyLabels[i.app]}</span>
                <span className="hub-attention-title">
                  <b dir="ltr">{i.number}</b> · {i.title}
                </span>
                <small>{place(i)}</small>
                <span className="hub-attention-flags">
                  {i.urgent && <span className="badge red">عاجلة</span>}
                  {i.lateMinutes !== null && (
                    <span className="dash-deadline late">
                      <Clock size={12} />
                      {deadlineLabel({ minutes: -i.lateMinutes, late: true })}
                    </span>
                  )}
                </span>
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
            ))}
            {attention.length > 8 && (
              <p className="hub-more">و{n(attention.length - 8)} أخرى داخل التطبيقات.</p>
            )}
          </div>
        ) : (
          <p className="hub-clear">
            <CheckCircle2 size={17} aria-hidden="true" /> لا توجد حالات متأخرة أو عاجلة الآن.
          </p>
        )}
      </section>

      <div className="hub-apps" style={{ "--apps": sections.length } as React.CSSProperties}>
        {sections.map((app) => {
          const Icon = icons[app];
          const f = figures[app];
          const allowNew = newPermission[app].some((p) => data.permissions.includes(p));
          return (
            <section key={app} className={"hub-app " + app} aria-labelledby={"hub-app-" + app}>
              <header>
                <span className="hub-app-icon" aria-hidden="true">
                  <Icon size={22} strokeWidth={1.9} />
                </span>
                <h2 id={"hub-app-" + app}>{appLabels[app]}</h2>
                <button type="button" className="text-btn" onClick={() => onGo(mainView[app])}>
                  فتح <ArrowLeft size={15} aria-hidden="true" />
                </button>
              </header>
              {failed[app] ? (
                <p className="hub-app-error" role="alert">
                  تعذر تحميل الأرقام: {failed[app]}{" "}
                  <button type="button" className="text-btn" onClick={load}>
                    إعادة المحاولة
                  </button>
                </p>
              ) : !f ? (
                <p className="hub-app-loading" role="status">
                  <RefreshCw size={16} className="spin" /> جارٍ التحميل…
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    className="hub-app-open"
                    onClick={() => onGo(mainView[app])}
                  >
                    <b>{n(f.open)}</b>
                    <span>{openLabel[app]}</span>
                  </button>
                  <dl>
                    <div className={f.late ? "bad" : ""}>
                      <dt>متأخرة</dt>
                      <dd>{n(f.late)}</dd>
                    </div>
                    <div className={f.urgent ? "warn" : ""}>
                      <dt>عاجلة</dt>
                      <dd>{n(f.urgent)}</dd>
                    </div>
                    <div>
                      <dt>بدون إسناد</dt>
                      <dd>{n(f.unassigned)}</dd>
                    </div>
                    {app === "cs" ? (
                      refunds !== null && (
                        <div>
                          <dt>استرجاع قيد الإجراء</dt>
                          <dd>{n(refunds)}</dd>
                        </div>
                      )
                    ) : (
                      <div>
                        <dt>بانتظار التأكيد</dt>
                        <dd>{n(f.awaitingConfirm)}</dd>
                      </div>
                    )}
                  </dl>
                </>
              )}
              <footer>
                {allowNew && (
                  <button type="button" className="secondary" onClick={() => onNew(app)}>
                    <Plus size={16} /> {newLabel[app]}
                  </button>
                )}
                {app === "cs" && refunds !== null && (
                  <button type="button" className="text-btn" onClick={() => onGo("refunds")}>
                    الاسترجاع
                  </button>
                )}
                {can(reportView[app]) && (
                  <button type="button" className="text-btn" onClick={() => onGo(reportView[app])}>
                    التقارير
                  </button>
                )}
              </footer>
            </section>
          );
        })}
      </div>
    </div>
  );
}
