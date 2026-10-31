import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCheck,
  Inbox,
  MessageSquare,
  QrCode,
  Search,
  Siren,
  Ticket as TicketIcon,
  Users,
  Wallet,
} from "lucide-react";
import { AttentionStrip, CaseRow, DashHello, KpiCards, type Kpi } from "./dashboard-bits";
import {
  Data,
  SummaryCounts,
  Ticket,
  categories,
  date,
  n,
  states,
  risk,
  summaryFor,
} from "./types";
import { Empty } from "./ui";
const KPI_LOOK: Record<string, Pick<Kpi, "icon" | "tone">> = {
  open: { icon: TicketIcon, tone: "burgundy" },
  waiting: { icon: Inbox, tone: "amber" },
  contact: { icon: MessageSquare, tone: "blue" },
  escalated: { icon: Siren, tone: "red" },
  urgent: { icon: AlertTriangle, tone: "red" },
  late: { icon: AlertTriangle, tone: "red" },
  closed: { icon: CheckCheck, tone: "green" },
  refunds: { icon: Wallet, tone: "amber" },
};
const unassigned = (t: Ticket) => !t.resolutionOwner || t.resolutionOwner === t.branchId;
const finished = (status: string) => ["COMPLETED", "REJECTED"].includes(status);
export function RoleWorkspace({
  data,
  brand,
  onOpen,
  onNavigate,
  recordsOnly = false,
}: {
  data: Data;
  brand: string;
  onOpen: (id: string) => void;
  onNavigate: (id: string) => void;
  recordsOnly?: boolean;
}) {
  const [queue, setQueue] = useState(recordsOnly ? "all" : "open"),
    [search, setSearch] = useState("");
  const role = data.me.role,
    executive = ["CEO", "OWNER"].includes(role),
    operations = role === "OPERATIONS_MANAGER",
    lead = role === "SHIFT_LEAD",
    marketing = role === "MARKETING_MANAGER",
    superadmin = role === "SUPER_ADMIN";
  const cases = data.tickets.filter(
    (t) =>
      (brand === "all" || t.brandId === brand) &&
      (!operations || (t.escalated && t.resolutionOwner === data.me.id)),
  );
  const brands = data.brands.filter((b) => brand === "all" || b.id === brand);
  const refunds = data.refunds.filter((r) => brand === "all" || r.brandId === brand);
  const active = cases.filter((t) => t.state !== "CLOSED"),
    closed = cases.filter((t) => t.state === "CLOSED"),
    followup = active.filter((t) => t.state === "RESOLVED"),
    waiting = active.filter(unassigned),
    escalated = active.filter((t) => t.escalated),
    late = active.filter((t) => risk(t) === "late");
  // Exact counts from the server; the loaded cases are only the latest 500.
  const counts = summaryFor(data.ticketSummary, brand);
  const count = (bucket: keyof SummaryCounts, loaded: number) => counts?.[bucket] ?? loaded;
  const visible = cases
    .filter(
      (t) =>
        (queue === "all" ||
          (queue === "open"
            ? t.state !== "CLOSED"
            : queue === "waiting"
              ? unassigned(t) && t.state !== "CLOSED"
              : queue === "contact"
                ? t.state === "RESOLVED"
                : queue === "escalated"
                  ? t.escalated && t.state !== "CLOSED"
                  : queue === "closed"
                    ? t.state === "CLOSED"
                    : queue === "late"
                      ? risk(t) === "late" && t.state !== "CLOSED"
                      : queue === "urgent"
                        ? (t.priority === "P1" || risk(t) === "late") && t.state !== "CLOSED"
                        : true)) &&
        (!search ||
          [t.number, t.branch?.name, t.brand.name, categories[t.category]]
            .join(" ")
            .includes(search.trim())),
    )
    .sort((a, b) =>
      executive
        ? +new Date(b.receivedAt) - +new Date(a.receivedAt)
        : a.priority.localeCompare(b.priority) || +new Date(a.receivedAt) - +new Date(b.receivedAt),
    );
  const metrics = operations
    ? [
        { label: "تصعيدات مفتوحة", value: count("active", active.length), key: "open" },
        {
          label: "حرجة أو متأخرة",
          value: count(
            "urgent",
            active.filter((t) => t.priority === "P1" || risk(t) === "late").length,
          ),
          key: "urgent",
        },
        { label: "جاهزة لتواصل الدعم", value: count("followup", followup.length), key: "contact" },
        { label: "تم الحل", value: count("closed", closed.length), key: "closed" },
      ]
    : lead
      ? [
          { label: "بانتظار الإسناد", value: count("waiting", waiting.length), key: "waiting" },
          { label: "شكاوى مفتوحة", value: count("active", active.length), key: "open" },
          { label: "بانتظار التواصل", value: count("followup", followup.length), key: "contact" },
          { label: "تحتاج تدخلك", value: count("escalated", escalated.length), key: "escalated" },
        ]
      : [
          { label: "شكاوى مفتوحة", value: count("active", active.length), key: "open" },
          { label: "تم الحل", value: count("closed", closed.length), key: "closed" },
          {
            label: "تصعيدات مفتوحة",
            value: count("escalated", escalated.length),
            key: "escalated",
          },
          {
            label: executive ? "طلبات استرجاع قيد المتابعة" : "حالات متأخرة",
            value: executive
              ? refunds.filter((r) => !finished(r.status)).length
              : count("late", late.length),
            key: executive ? "refunds" : "late",
          },
        ];
  const lateNow = count("late", late.length),
    openNow = count("active", active.length);
  const helloLine = openNow
    ? `${n(openNow)} شكاوى مفتوحة${lateNow ? `، منها ${n(lateNow)} متأخرة` : ""}${
        lead && waiting.length ? ` و${n(count("waiting", waiting.length))} بانتظار الإسناد` : ""
      }.`
    : "لا توجد شكاوى مفتوحة الآن ضمن نطاقك.";
  const shortCuts = superadmin
    ? [
        {
          id: "users",
          label: "المستخدمون والصلاحيات",
          detail: "إدارة الحسابات والوصول",
          icon: Users,
        },
        {
          id: "branches",
          label: "العلامات والفروع",
          detail: n(brands.length) + " علامات في النطاق",
          icon: Building2,
        },
        {
          id: "qr",
          label: "رموز استقبال الشكاوى",
          detail: "إنشاء الروابط ومتابعة الرموز",
          icon: QrCode,
        },
        {
          id: "refunds",
          label: "طلبات الاسترجاع",
          detail: n(refunds.filter((r) => !finished(r.status)).length) + " قيد المتابعة",
          icon: Wallet,
        },
      ]
    : marketing
      ? [
          { id: "tickets", label: "شكاوى العملاء", detail: "متابعة الفريق والتصعيد", icon: Users },
          {
            id: "qr",
            label: "استقبال العملاء عبر QR",
            detail: "رموز الفروع ونماذج الشكاوى",
            icon: QrCode,
          },
          {
            id: "reports",
            label: "تقارير العلامات",
            detail: "المتابعة حسب العلامة والفرع",
            icon: Building2,
          },
        ]
      : [];
  return (
    <div className={"role-workspace role-" + role.toLowerCase()}>
      {!recordsOnly && (
        <>
          <DashHello name={data.me.name} line={helloLine} />
          <KpiCards
            selected={queue}
            onPick={(key) =>
              key === "refunds" ? onNavigate("refunds") : setQueue(queue === key ? "open" : key)
            }
            items={metrics.map((m): Kpi => ({
              ...m,
              icon: KPI_LOOK[m.key]!.icon,
              tone: KPI_LOOK[m.key]!.tone,
            }))}
          />
          <AttentionStrip tickets={cases} onOpen={onOpen} />
          {!!shortCuts.length && (
            <section className="role-shortcuts" aria-label="اختصارات الدور">
              {shortCuts.map((s) => (
                <button className="secondary" key={s.id} onClick={() => onNavigate(s.id)}>
                  <s.icon size={22} />
                  <span>
                    <b>{s.label}</b>
                  </span>
                  <ArrowLeft size={16} />
                </button>
              ))}
            </section>
          )}
          {(executive || marketing) && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>{role === "OWNER" ? "العلامات ضمن ملكيتي" : "تجربة العملاء حسب العلامة"}</h2>
                </div>
                <button className="secondary" onClick={() => onNavigate("reports")}>
                  عرض التقارير
                  <ArrowLeft size={16} />
                </button>
              </div>
              {role === "OWNER" ? (
                <div className="owner-portfolio">
                  {brands.map((b) => {
                    const own = cases.filter((t) => t.brandId === b.id);
                    return (
                      <article key={b.id}>
                        <img src={"/logos/" + b.logo} alt={b.name} />
                        <h3>{b.name}</h3>
                        <p>{n(b.branches.length)} فروع مرتبطة</p>
                        <dl>
                          <div>
                            <dt>مفتوحة</dt>
                            <dd>{n(own.filter((t) => t.state !== "CLOSED").length)}</dd>
                          </div>
                          <div>
                            <dt>تم الحل</dt>
                            <dd>{n(own.filter((t) => t.state === "CLOSED").length)}</dd>
                          </div>
                          <div>
                            <dt>طلبات مالية نشطة</dt>
                            <dd>
                              {n(
                                refunds.filter((r) => r.brandId === b.id && !finished(r.status))
                                  .length,
                              )}
                            </dd>
                          </div>
                        </dl>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>العلامة</th>
                        <th>مفتوحة</th>
                        <th>تم الحل</th>
                        <th>تصعيدات</th>
                        {marketing && <th>عبر QR / الهاتف</th>}
                        <th>استرجاع قيد المتابعة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {brands.map((b) => {
                        const own = cases.filter((t) => t.brandId === b.id);
                        return (
                          <tr key={b.id}>
                            <td>
                              <span className="role-brand-name">
                                <img src={"/logos/" + b.logo} alt="" />
                                {b.name}
                              </span>
                            </td>
                            <td>{n(own.filter((t) => t.state !== "CLOSED").length)}</td>
                            <td>{n(own.filter((t) => t.state === "CLOSED").length)}</td>
                            <td>
                              {n(own.filter((t) => t.escalated && t.state !== "CLOSED").length)}
                            </td>
                            {marketing && (
                              <td>
                                {n(own.filter((t) => t.source === "PUBLIC_QR").length)} /{" "}
                                {n(own.filter((t) => t.source === "PHONE_AGENT").length)}
                              </td>
                            )}
                            <td>
                              {n(
                                refunds.filter((r) => r.brandId === b.id && !finished(r.status))
                                  .length,
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          {lead && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>توزيع العمل على الفريق</h2>
                </div>
                <button className="secondary" onClick={() => onNavigate("tickets")}>
                  استقبال وإسناد الشكاوى
                  <ArrowLeft size={16} />
                </button>
              </div>
              {data.users.filter(
                (u) => u.role === "AGENT" && (brand === "all" || u.brandIds.includes(brand)),
              ).length ? (
                <div className="team-workload">
                  {data.users
                    .filter(
                      (u) => u.role === "AGENT" && (brand === "all" || u.brandIds.includes(brand)),
                    )
                    .map((u) => (
                      <div key={u.id}>
                        <span className="avatar small">{u.name[0]}</span>
                        <b>{u.name}</b>
                        <span>
                          {n(
                            active.filter(
                              (t) => t.resolutionOwner === u.id || t.communicationsOwner === u.id,
                            ).length,
                          )}{" "}
                          حالات مفتوحة
                        </span>
                      </div>
                    ))}
                </div>
              ) : (
                <Empty
                  title="لا يوجد موظفون ضمن النطاق"
                  detail="يضيف المسؤول الأعلى الموظفين ويربطهم بالعلامات المسموح بها."
                />
              )}
            </section>
          )}
        </>
      )}
      <section className="panel role-case-queue">
        <div className="panel-head">
          <div>
            <h2>
              {operations
                ? "قائمة التصعيدات المسندة"
                : executive
                  ? "سجل المتابعة"
                  : lead
                    ? "أولويات الإسناد والمتابعة"
                    : "أولويات الشكاوى"}
            </h2>
          </div>
          {!executive && <span className="badge neutral">{n(visible.length)} حالات</span>}
        </div>
        <div className="agent-queue-controls">
          <label className="qr-search">
            <Search size={17} />
            <input
              aria-label="بحث قائمة الدور"
              placeholder="رقم الشكوى، العلامة أو الفرع"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="تصفية قائمة الدور"
            value={queue}
            onChange={(e) => setQueue(e.target.value)}
          >
            <option value="open">المفتوحة</option>
            {!operations && <option value="waiting">بانتظار الإسناد</option>}
            <option value="contact">بانتظار التواصل</option>
            <option value="escalated">قيد التصعيد</option>
            <option value="late">متأخرة</option>
            {operations && <option value="urgent">حرجة أو متأخرة</option>}
            <option value="closed">تم الحل</option>
            <option value="all">السجل الكامل</option>
          </select>
        </div>
        {!visible.length ? (
          <Empty
            title={operations ? "لا توجد تصعيدات في هذه القائمة" : "لا توجد شكاوى في هذه القائمة"}
            detail={
              operations
                ? "عندما يُصعّد فريق خدمة العملاء شكوى إليك، ستظهر هنا."
                : "تظهر الحالات عند استقبالها ضمن العلامات والفروع المصرح بها."
            }
          />
        ) : (
          <div className="dash-case-list">
            {visible.slice(0, recordsOnly ? 500 : 12).map((t) => (
              <CaseRow
                key={t.id}
                t={t}
                onOpen={onOpen}
                status={states[t.state]!}
                action={
                  executive
                    ? "عرض التفاصيل"
                    : operations
                      ? "متابعة التصعيد"
                      : unassigned(t) && data.permissions.includes("assign")
                        ? "إسناد الشكوى"
                        : "متابعة الشكوى"
                }
              />
            ))}
          </div>
        )}
        {!recordsOnly && visible.length > 12 && (
          <div className="padded">
            <button className="secondary" onClick={() => onNavigate("tickets")}>
              عرض بقية الحالات
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
