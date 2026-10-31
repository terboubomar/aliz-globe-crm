import { useState, useEffect, useCallback, useRef, FormEvent } from "react";
import {
  LayoutDashboard,
  Ticket as TicketIcon,
  Wallet,
  Users,
  CalendarDays,
  Settings,
  ChevronLeft,
  Plus,
  Search,
  Bell,
  ArrowLeft,
  Clock,
  CheckCheck,
  AlertTriangle,
  Headphones,
  Menu,
  X,
  LogOut,
  QrCode,
  Phone,
  MessageSquare,
  Check,
  RefreshCw,
  Activity,
  ListTodo,
  ShieldCheck,
  Send,
  Building2,
  Upload,
  PanelRightClose,
  PanelRightOpen,
  Home,
  MoreHorizontal,
} from "lucide-react";
import {
  Data,
  Ticket,
  api,
  categories,
  activeCategories,
  activePlatforms,
  states,
  roleNames,
  eventNames,
  date,
  n,
  risk,
  summaryFor,
} from "./types";
import { Modal, Empty, Submit, Field } from "./ui";
import { ComplaintsWorkspace, ComplaintJourney } from "./complaints";
import { ComplaintActionPanel } from "./complaint-actions";
import { RefundWorkspace } from "./refund-workspace";
import { DirectoryWorkspace } from "./directory-workspace";
import { SignIn } from "./sign-in";
import { QRWorkspace, QRPanel } from "./qr-workspace";
import { UsersWorkspace } from "./users-workspace";
import { canOpenView, roleWorkspaces, viewLabel } from "./access";
import { AgentWorkspace } from "./agent-workspace";
import { agentInvolved } from "./workflow";
import { ScheduleWorkspace } from "./schedule-workspace";
import { TelegramAccount } from "./telegram-integration";
import { TwoStepAccount } from "./two-step-account";
import { CustomerCard } from "./customer-card";
import { SettingsWorkspace } from "./settings-workspace";
import { ReasonPicker } from "./reason-options";
import { ReportsWorkspace } from "./reports-workspace";
import { RoleWorkspace } from "./role-workspace";
import { EvidenceLink } from "./evidence";
import { AccessGate } from "./access-gate";
import { AccessError } from "./adapter";
const navigation = [
  { id: "overview", label: "نظرة عامة", icon: LayoutDashboard },
  { id: "tickets", label: "الشكاوى", icon: TicketIcon },
  { id: "refunds", label: "الاسترجاع والإلغاء", icon: Wallet },
  { id: "branches", label: "العلامات والفروع", icon: Building2 },
  { id: "qr", label: "رموز الفروع QR", icon: QrCode },
  { id: "customers", label: "العملاء", icon: Users },
  { id: "tasks", label: "المهام والمتابعة", icon: ListTodo },
  { id: "schedule", label: "جدولة الفريق", icon: CalendarDays },
  { id: "reports", label: "التقارير", icon: Activity },
  { id: "users", label: "المستخدمون والصلاحيات", icon: ShieldCheck },
  { id: "settings", label: "الإعدادات", icon: Settings },
];
function form(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
}
function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={"badge " + tone}>{children}</span>;
}
export default function CRM() {
  const authEpoch = useRef(0);
  const openedTelegramTicket = useRef<string | null>(null);
  const [data, setData] = useState<Data | null>(null),
    [loggingOut, setLoggingOut] = useState(false),
    [checkingSession, setCheckingSession] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [view, setView] = useState("overview"),
    [brand, setBrand] = useState("all"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [menu, setMenu] = useState(false),
    [rail, setRail] = useState(true),
    [railReady, setRailReady] = useState(false),
    [modal, setModal] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [toast, setToast] = useState(""),
    [notifications, setNotifications] = useState(false),
    [access, setAccess] = useState<AccessError["code"] | null>(null);
  const load = useCallback(async () => {
    const epoch = authEpoch.current;
    try {
      const next = await api<Data>("bootstrap");
      if (epoch !== authEpoch.current) return;
      setAccess(null);
      setData(next);
      const requestedTicket = new URLSearchParams(window.location.search).get("ticket");
      if (
        requestedTicket &&
        /^[a-zA-Z0-9-]{1,100}$/.test(requestedTicket) &&
        openedTelegramTicket.current !== requestedTicket &&
        canOpenView("tickets", next.permissions, next.me.role)
      ) {
        openedTelegramTicket.current = requestedTicket;
        try {
          const detail = await api<Ticket>("tickets/" + requestedTicket);
          if (epoch !== authEpoch.current) return;
          setData((current) =>
            current
              ? {
                  ...current,
                  tickets: [...current.tickets.filter((t) => t.id !== detail.id), detail],
                }
              : current,
          );
          setSelected(detail.id);
          setModal("ticket");
        } catch {
          setToast("الشكوى غير متاحة ضمن صلاحيات حسابك.");
        }
      }
      setView((current) =>
        canOpenView(current, next.permissions, next.me.role)
          ? current
          : (navigation.find((i) => canOpenView(i.id, next.permissions, next.me.role))?.id ??
            "settings"),
      );
      setBrand((current) =>
        current === "all" || next.brands.some((b) => b.id === current) ? current : "all",
      );
      setError("");
    } catch (e) {
      if (epoch !== authEpoch.current) return;
      setData(null);
      setAccess(e instanceof AccessError ? e.code : null);
      const message = (e as Error).message;
      setError(message === "يرجى تسجيل الدخول" || message === "الحساب غير مفعل" ? "" : message);
    } finally {
      if (epoch === authEpoch.current) setCheckingSession(false);
    }
  }, []);
  async function logout() {
    openedTelegramTicket.current = null;
    authEpoch.current++;
    setLoggingOut(true);
    try {
      await api("logout", {});
      setData(null);
      setAccess(null);
      setError("");
      setCheckingSession(false);
      setBrand("all");
      setSearch("");
      setFilter("all");
      setMenu(false);
      setModal(null);
      setSelected(null);
      setNotifications(false);
      setToast("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoggingOut(false);
    }
  }
  useEffect(() => {
    load();
    const v = new URLSearchParams(window.location.search).get("view");
    if (navigation.some((i) => i.id === v)) setView(v!);
  }, [load]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [toast]);
  // Whether the navigation rail is visible is the staff member's own choice,
  // remembered between visits. Read after mount so the first render matches
  // the server-rendered markup.
  useEffect(() => {
    try {
      setRail(localStorage.getItem("aliz-sidebar") !== "hidden");
    } catch {
      /* storage unavailable: keep the rail open */
    }
    // Animate only later toggles, not the restored state on load.
    const frame = requestAnimationFrame(() => setRailReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  // Ctrl+B / ⌘B switches between the full sidebar and the icon rail.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "b")
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      setRail((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("aliz-sidebar", rail ? "shown" : "hidden");
    } catch {
      /* storage unavailable: nothing to remember */
    }
  }, [rail]);
  async function mutate(path: string, body?: unknown) {
    setBusy(true);
    try {
      const result = await api(path, body ?? {});
      await load();
      setToast("تم حفظ التحديث");
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!menu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(false);
        document
          .querySelector<HTMLButtonElement>('.mobile-only[aria-controls="crm-sidebar"]')
          ?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menu]);
  function go(id: string) {
    if (data && !canOpenView(id, data.permissions, data.me.role)) return;
    setView(id);
    setFilter("all");
    setSearch("");
    setMenu(false);
    window.history.replaceState(null, "", "?view=" + id);
  }
  if (!data && access) return <AccessGate code={access} onDone={load} onSignOut={logout} />;
  if (!data)
    return (
      <SignIn
        checking={checkingSession}
        connectionError={error}
        onSignIn={async (email, password) => {
          setError("");
          await api("login", { email, password });
          await load();
        }}
      />
    );
  const isAgent = data.me.role === "AGENT";
  const workspace = roleWorkspaces[data.me.role];
  const executive = ["CEO", "OWNER"].includes(data.me.role);
  const customRecords = executive || data.me.role === "OPERATIONS_MANAGER";
  const permit = (p: string) => data.permissions.includes(p),
    filtered = data.tickets.filter(
      (t) =>
        (brand === "all" || t.brandId === brand) &&
        (!search ||
          [t.number, t.externalOrder, t.description, categories[t.category], t.branch?.name]
            .join(" ")
            .includes(search)) &&
        (filter === "all" ||
          (filter === "late" && risk(t) === "late") ||
          (filter === "mine" && t.communicationsOwner === data.me.id) ||
          (filter === "unassigned" && t.communicationsOwner === "UNASSIGNED") ||
          t.state === filter),
    ),
    open = filtered
      .filter((t) => t.state !== "CLOSED")
      .sort((a, b) => {
        const urgency = { late: 0, soon: 1, ok: 2 };
        return (
          a.priority.localeCompare(b.priority) ||
          urgency[risk(a)] - urgency[risk(b)] ||
          +new Date(a.receivedAt) - +new Date(b.receivedAt)
        );
      }),
    late = open.filter((t) => risk(t) === "late"),
    ticket = data.tickets.find((t) => t.id === selected),
    branches = data.brands.flatMap((b) => b.branches),
    brandTickets = (id: string) => data.tickets.filter((t) => t.brandId === id),
    title =
      view === "overview" && workspace
        ? workspace.title
        : viewLabel(
            view,
            data.me.role,
            navigation.find((v) => v.id === view)?.label ?? "نظرة عامة",
          );
  const heading = title;
  const userName = (id: string) =>
    id === "UNASSIGNED" ? "غير مسند" : (data.users.find((u) => u.id === id)?.name ?? id);
  const openTicket = async (id: string) => {
    const epoch = authEpoch.current;
    try {
      const latest = await api<Ticket>("tickets/" + id);
      if (epoch !== authEpoch.current) return;
      setData((current) =>
        current
          ? { ...current, tickets: [...current.tickets.filter((t) => t.id !== id), latest] }
          : current,
      );
      setSelected(id);
      setModal("ticket");
    } catch (e) {
      if (epoch === authEpoch.current) setError((e as Error).message);
    }
  };
  // Quick bar for phones and tablets: the main views this role can open (two
  // on phones, four on tablets), a new phone complaint (when allowed), alerts
  // and, on phones, "more" (the full menu; tablets keep the sidebar).
  const quickViews = ["overview", "tickets", "refunds", "tasks", "schedule"]
    .filter((id) => canOpenView(id, data.permissions, data.me.role))
    .slice(0, 4)
    .map((id) => navigation.find((item) => item.id === id)!);
  const exactOpenCount = summaryFor(data.ticketSummary, "all")?.active;
  const quickOpen =
    exactOpenCount !== undefined || data.ticketCount === data.tickets.length
      ? (exactOpenCount ?? data.tickets.filter((t) => t.state !== "CLOSED").length)
      : 0;
  return (
    <div
      className={"app-shell" + (rail ? "" : " rail-compact") + (railReady ? " rail-animate" : "")}
    >
      <aside
        id="crm-sidebar"
        aria-label="القائمة الجانبية"
        className={"sidebar " + (menu ? "shown" : "")}
      >
        <div className="sidebar-heading">
          <a className="group-logo" href="/" aria-label="الرئيسية">
            <img src="/logos/aliz.webp" alt="Aliz Globe Company" />
            <span>
              <b>أليز غلوب</b>
              <small>CRM</small>
            </span>
          </a>
          <button
            type="button"
            className="icon-btn sidebar-close"
            aria-label="إغلاق التنقل"
            onClick={() => setMenu(false)}
          >
            <X size={19} />
          </button>
        </div>
        <nav aria-label="التنقل الرئيسي">
          {[
            {
              id: "work",
              label: "مساحة العمل",
              items: [
                "overview",
                "tickets",
                "refunds",
                "customers",
                "tasks",
                "schedule",
                "reports",
              ],
            },
            { id: "management", label: "الإدارة", items: ["branches", "qr", "users", "settings"] },
          ].map((group) => {
            const items = group.items
              .map((id) => navigation.find((item) => item.id === id)!)
              .filter((item) => canOpenView(item.id, data.permissions, data.me.role));
            if (!items.length) return null;
            return (
              <div className="sidebar-nav-group" key={group.id}>
                <h2 className="nav-label" id={"nav-" + group.id}>
                  {group.label}
                </h2>
                <div role="group" aria-labelledby={"nav-" + group.id}>
                  {items.map((item) => {
                    const Icon = item.icon;
                    const active = view === item.id;
                    const exactOpen = summaryFor(data.ticketSummary, "all")?.active;
                    const openCount =
                      exactOpen ?? data.tickets.filter((t) => t.state !== "CLOSED").length;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={active ? "active" : ""}
                        aria-current={active ? "page" : undefined}
                        title={rail ? undefined : viewLabel(item.id, data.me.role, item.label)}
                        onClick={() => go(item.id)}
                      >
                        <span className="sidebar-nav-icon">
                          <Icon size={19} strokeWidth={active ? 2 : 1.7} />
                        </span>
                        <span className="sidebar-nav-text">
                          {viewLabel(item.id, data.me.role, item.label)}
                        </span>
                        {item.id === "tickets" &&
                          openCount > 0 &&
                          (exactOpen !== undefined || data.ticketCount === data.tickets.length) && (
                            <small
                              className="nav-count"
                              aria-label={`${n(openCount)} شكاوى مفتوحة`}
                            >
                              {n(openCount)}
                            </small>
                          )}
                        {active && (
                          <ChevronLeft
                            className="sidebar-nav-current"
                            size={15}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile" title={rail ? undefined : data.me.name}>
            <span className="avatar">{data.me.name.slice(0, 1)}</span>
            <div>
              <b>{data.me.name}</b>
              <small>{roleNames[data.me.role] ?? data.me.role}</small>
            </div>
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="mobile-overlay"
          aria-label="إغلاق القائمة"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              type="button"
              className="icon-btn sidebar-toggle"
              aria-label={rail ? "تصغير القائمة الجانبية" : "توسيع القائمة الجانبية"}
              title={(rail ? "تصغير القائمة الجانبية" : "توسيع القائمة الجانبية") + " (Ctrl+B)"}
              aria-expanded={rail}
              aria-controls="crm-sidebar"
              onClick={() => setRail(!rail)}
            >
              {rail ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
            </button>
            <button
              className="icon-btn mobile-only"
              aria-label="فتح القائمة"
              aria-expanded={menu}
              aria-controls="crm-sidebar"
              onClick={() => setMenu(!menu)}
            >
              <Menu />
            </button>
            <span>مساحة العمل</span>
            <ChevronLeft size={14} />
            <b>{title}</b>
          </div>
          <div className="top-tools">
            <button
              className="icon-btn notification-btn"
              aria-label="التنبيهات"
              onClick={() => setNotifications(!notifications)}
            >
              <Bell size={20} />
              {late.length > 0 && <i />}
            </button>
            <button
              className="avatar small profile-trigger"
              type="button"
              aria-label="قائمة الحساب"
              title="الحساب"
              popoverTarget="account-menu"
            >
              {data.me.name.slice(0, 1)}
            </button>
            <div id="account-menu" popover="auto" className="profile-dropdown" aria-label="الحساب">
              <div className="profile-dropdown-identity">
                <b>{data.me.name}</b>
                <small>{roleNames[data.me.role] ?? data.me.role}</small>
              </div>
              <button
                className="text-btn"
                onClick={(event) => {
                  setModal("telegram");
                  event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
                }}
              >
                <Send size={17} />
                تنبيهات تيليجرام
              </button>
              <button
                className="text-btn"
                onClick={(event) => {
                  setModal("two-step");
                  event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
                }}
              >
                <ShieldCheck size={17} />
                التحقق بخطوتين
              </button>
              <button
                className="text-btn profile-logout"
                aria-label="تسجيل الخروج"
                disabled={loggingOut}
                onClick={logout}
              >
                <LogOut size={17} />
                {loggingOut ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"}
              </button>
            </div>
          </div>
        </header>
        {notifications && (
          <section className="notification-panel">
            <div className="panel-head">
              <h3>تحتاج إلى انتباهك</h3>
              <button className="text-btn" onClick={() => setNotifications(false)}>
                إغلاق
              </button>
            </div>
            {late.length ? (
              late.slice(0, 5).map((t) => (
                <button
                  className="notification-item"
                  key={t.id}
                  onClick={() => {
                    openTicket(t.id);
                    setNotifications(false);
                  }}
                >
                  <AlertTriangle size={17} />
                  <span>
                    <b dir="ltr">{t.number}</b>
                    <small>مهلة تجريبية متجاوزة • {t.branch?.name}</small>
                  </span>
                  <ChevronLeft size={16} />
                </button>
              ))
            ) : (
              <Empty title="لا توجد تنبيهات في نطاق العرض" />
            )}
          </section>
        )}
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="date-label">
                {new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
                  calendar: "gregory",
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "Asia/Riyadh",
                }).format(new Date())}
              </div>
              <h1>{heading}</h1>
            </div>
            <div className="heading-actions">
              {permit("create") && ["overview", "tickets"].includes(view) && (
                <button className="primary heading-create" onClick={() => setModal("create")}>
                  <Plus size={19} />
                  تسجيل شكوى هاتفية
                </button>
              )}
            </div>
          </div>

          {!["reports", "settings"].includes(view) && data.ticketCount > data.tickets.length && (
            <div className="notice">
              تُعرض آخر {n(data.tickets.length)} حالة من أصل {n(data.ticketCount)} ضمن نطاقك.
              المؤشرات للسجلات المحمّلة فقط.
            </div>
          )}
          {!permit("read") && (
            <div className="notice">
              هذا الحساب لا يملك صلاحية عرض البلاغات. يمكنك إدارة الفروع والرموز أو الجدولة حسب
              دورك.
            </div>
          )}
          {error && (
            <div className="error-bar" role="alert">
              {error}
              <button className="text-btn" onClick={() => setError("")}>
                إغلاق
              </button>
            </div>
          )}
          {view !== "settings" && (
            <div className="scope-toolbar">
              {view !== "schedule" && (
                <div className="scope-select">
                  <Building2 size={17} />
                  <select
                    aria-label="تصفية حسب العلامة"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                  >
                    <option value="all">جميع العلامات</option>
                    {data.brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!isAgent && view !== "schedule" && (
                <span className="scope-note">
                  {brand === "all"
                    ? "نطاق المجموعة"
                    : data.brands.find((b) => b.id === brand)?.name}{" "}
                  <span>•</span> Asia/Riyadh
                </span>
              )}
              <button
                className="text-btn refresh"
                onClick={() => {
                  load();
                  setToast("تم تحديث البيانات");
                }}
              >
                <RefreshCw size={14} />
                تحديث
              </button>
            </div>
          )}
          {isAgent && ["overview", "tickets"].includes(view) && (
            <AgentWorkspace
              key={view + brand}
              browseAll={view === "tickets"}
              data={data}
              brand={brand}
              onOpen={openTicket}
              onPhone={() => setModal("create")}
            />
          )}
          {workspace &&
            !isAgent &&
            (view === "overview" || (view === "tickets" && customRecords)) && (
              <RoleWorkspace
                key={view + brand}
                data={data}
                brand={brand}
                onOpen={openTicket}
                onNavigate={go}
                recordsOnly={view === "tickets"}
              />
            )}
          {view === "overview" && !workspace && (
            <>
              <section className="metrics">
                {[
                  {
                    label: "البلاغات المفتوحة",
                    value: open.length,
                    icon: TicketIcon,
                    foot: "حالات نشطة تحتاج إلى متابعة",
                    tone: "burgundy",
                  },
                  {
                    label: "بانتظار استلام الفرع",
                    value: filtered.filter((t) => t.state === "ASSIGNED").length,
                    icon: Clock,
                    foot: "توجيه واضح ومسؤول محدد",
                    tone: "amber",
                  },
                  {
                    label: "مهل تجريبية متجاوزة",
                    value: late.length,
                    icon: AlertTriangle,
                    foot: "تحتاج إلى مراجعة المشرف",
                    tone: "red",
                  },
                  {
                    label: "تمت المعالجة",
                    value: filtered.filter((t) => ["RESOLVED", "CLOSED"].includes(t.state)).length,
                    icon: CheckCheck,
                    foot: "المعالجة منفصلة عن الإغلاق",
                    tone: "green",
                  },
                ].map((m) => (
                  <article className="metric" key={m.label}>
                    <div className="metric-title">
                      {m.label}
                      <m.icon size={19} />
                    </div>
                    <div className={"metric-value " + m.tone}>{n(m.value)}</div>
                    <div className="metric-foot">
                      <span className={"tiny-dot " + m.tone} />
                      {m.foot}
                    </div>
                  </article>
                ))}
              </section>
              <section className="brand-section">
                <div className="section-label">
                  <h2>علامات المجموعة</h2>
                  <span>{n(data.brands.length)} علامات • هوية المجموعة</span>
                </div>
                <div className="brand-strip">
                  {data.brands.map((b) => (
                    <button
                      key={b.id}
                      className={"brand-tile " + (brand === b.id ? "selected" : "")}
                      onClick={() => setBrand(brand === b.id ? "all" : b.id)}
                    >
                      <img src={"/logos/" + b.logo} alt={b.name} />
                      <div>
                        <b>{b.name}</b>
                        <small>
                          {n(brandTickets(b.id).filter((t) => t.state !== "CLOSED").length)} بلاغات
                          مفتوحة
                        </small>
                      </div>
                      <span className="brand-indicator" style={{ background: b.color }} />
                    </button>
                  ))}
                </div>
              </section>
              <div className="overview-grid">
                <section className="panel priority-panel">
                  <div className="panel-head">
                    <div>
                      <h2>
                        الأولوية الآن <span className="count-badge">{n(open.length)}</span>
                      </h2>
                    </div>
                    <button className="text-btn" onClick={() => go("tickets")}>
                      كل الشكاوى <ChevronLeft size={16} />
                    </button>
                  </div>
                  <div className="queue-tabs">
                    {[
                      { id: "all", label: "كل الحالات" },
                      { id: "late", label: "متجاوزة المهلة" },
                      { id: "unassigned", label: "غير مسندة" },
                      { id: "mine", label: "مسندة إليّ" },
                    ].map((f) => (
                      <button
                        className={filter === f.id ? "current" : ""}
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <TicketTable tickets={open.slice(0, 5)} onOpen={openTicket} userName={userName} />
                  <div className="panel-bottom">
                    <button className="text-btn" onClick={() => go("tickets")}>
                      فتح قائمة العمل <ArrowLeft size={15} />
                    </button>
                  </div>
                </section>
                <aside className="panel activity-panel">
                  <div className="panel-head">
                    <div>
                      <h2>نبض العمليات</h2>
                    </div>
                    <Activity size={19} />
                  </div>
                  <div className="activity-list">
                    {filtered
                      .flatMap((t) => t.events.map((e) => ({ ...e, ticket: t })))
                      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
                      .slice(0, 5)
                      .map((e) => (
                        <button
                          className="activity-item"
                          key={e.id}
                          onClick={() => openTicket(e.ticket.id)}
                        >
                          <span
                            className={
                              "activity-icon " + (e.type.includes("BREACH") ? "danger" : "")
                            }
                          >
                            <MessageSquare size={15} />
                          </span>
                          <span>
                            <b>{eventNames[e.type] ?? e.type}</b>
                            <small>
                              {e.ticket.brand.name} • <span dir="ltr">{e.ticket.number}</span>
                            </small>
                            <time>{date(e.createdAt)}</time>
                          </span>
                        </button>
                      ))}
                  </div>
                  <div className="handoff-note">
                    <Headphones size={24} />
                    <b>سجّل المكالمة، وابدأ المتابعة</b>

                    {permit("create") && (
                      <button className="text-btn" onClick={() => setModal("create")}>
                        تسجيل بلاغ جديد <Plus size={14} />
                      </button>
                    )}
                  </div>
                </aside>
              </div>
              <div className="bottom-summary">
                <div>
                  <span className="summary-icon">
                    <QrCode size={24} />
                  </span>
                  <div>
                    <h3>صوت العميل، يصل للفرع الصحيح.</h3>
                  </div>
                </div>
                <button className="secondary" onClick={() => go("qr")}>
                  إدارة رموز الفروع <ArrowLeft size={16} />
                </button>
              </div>
            </>
          )}
          {view === "tickets" && !isAgent && !customRecords && (
            <ComplaintsWorkspace
              key={brand}
              data={data}
              brand={brand}
              onOpen={openTicket}
              onPhone={() => setModal("create")}
              onQR={() => go("qr")}
            />
          )}
          {view === "refunds" && (
            <RefundWorkspace
              data={data}
              brand={brand}
              mutate={mutate}
              busy={busy}
              reload={load}
              onComplaint={openTicket}
            />
          )}
          {view === "branches" && (
            <DirectoryWorkspace
              key={brand}
              data={data}
              brand={brand}
              mutate={mutate}
              busy={busy}
              onQR={(id) => {
                setSelected(id);
                setModal("qr");
              }}
            />
          )}
          {view === "qr" && (
            <QRWorkspace
              data={data}
              brand={brand}
              onDirectory={() => go("branches")}
              onSettings={() => go("settings")}
            />
          )}
          {view === "customers" && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>البحث عن عميل</h2>
                </div>
              </div>
              {permit("pii") ? (
                <CustomerLookup onOpen={openTicket} />
              ) : (
                <Empty
                  title="بيانات العملاء غير متاحة لهذا الدور"
                  detail="تواصل مع المسؤول عند الحاجة إلى صلاحية محددة."
                />
              )}
            </section>
          )}
          {view === "tasks" && (
            <section className="panel">
              <div className="panel-head">
                <h2>المتابعات المطلوبة</h2>
              </div>
              {data.tasks.length ? (
                <div className="task-list">
                  {data.tasks
                    .filter((task) => filtered.some((t) => t.id === task.ticketId))
                    .map((task) => (
                      <div className="task-row" key={task.id}>
                        <Clock size={20} />
                        <button className="text-btn" onClick={() => openTicket(task.ticketId)}>
                          {data.tickets.find((t) => t.id === task.ticketId)?.number}
                        </button>
                        <span>{userName(task.owner)}</span>
                        <time>{date(task.dueAt)}</time>
                        {task.completedAt ? (
                          <Badge tone="green">مكتملة</Badge>
                        ) : (
                          permit("task") && (
                            <button
                              className="secondary"
                              onClick={() =>
                                mutate("tasks/" + task.id + "/complete").catch(() => {})
                              }
                            >
                              إكمال
                            </button>
                          )
                        )}
                      </div>
                    ))}
                </div>
              ) : (
                <Empty
                  title="لا توجد مهام متابعة"
                  detail="أضف مهمة من تفاصيل البلاغ وحدد موعداً ومسؤولاً."
                />
              )}
            </section>
          )}
          {view === "schedule" && <ScheduleWorkspace data={data} mutate={mutate} busy={busy} />}
          {view === "reports" && (
            <ReportsWorkspace data={data} brand={brand} onBrandChange={setBrand} />
          )}
          {view === "users" && <UsersWorkspace data={data} brand={brand} onChanged={load} />}
          {view === "settings" && (
            <SettingsWorkspace
              data={data}
              onMutate={mutate}
              onNavigate={go}
              onRole={async (id) => {
                await api("demo-login", { id });
                await load();
                setToast("تم تغيير الحساب التجريبي");
              }}
            />
          )}
          <footer className="page-footer">
            <span>أليز غلوب • إدارة تجربة العملاء</span>
          </footer>
        </main>
      </div>
      <nav className="quick-bar" aria-label="إجراءات سريعة">
        {quickViews.map((item, index) => {
          const Icon = item.id === "overview" ? Home : item.icon;
          const active = view === item.id && !menu;
          const label =
            item.id === "overview" ? "الرئيسية" : viewLabel(item.id, data.me.role, item.label);
          return (
            <button
              key={item.id}
              type="button"
              className={[active ? "active" : "", index > 1 ? "quick-bar-extra" : ""]
                .join(" ")
                .trim()}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                go(item.id);
                window.scrollTo({ top: 0 });
              }}
            >
              <span className="quick-bar-icon">
                <Icon size={21} strokeWidth={active ? 2.1 : 1.7} />
                {item.id === "tickets" && quickOpen > 0 && (
                  <small aria-label={`${n(quickOpen)} شكاوى مفتوحة`}>
                    {quickOpen > 99 ? "99+" : n(quickOpen)}
                  </small>
                )}
              </span>
              <span className="quick-bar-label quick-bar-short">{label.split(" ")[0]}</span>
              <span className="quick-bar-label quick-bar-full">{label}</span>
            </button>
          );
        })}
        {permit("create") && (
          <button
            type="button"
            className="quick-bar-primary"
            aria-label="تسجيل شكوى هاتفية"
            onClick={() => {
              setMenu(false);
              setModal("create");
            }}
          >
            <span className="quick-bar-icon">
              <Plus size={24} strokeWidth={2.2} />
            </span>
            <span className="quick-bar-label">شكوى جديدة</span>
          </button>
        )}
        {permit("read") && (
          <button
            type="button"
            className={notifications ? "active" : ""}
            aria-expanded={notifications}
            onClick={() => {
              setMenu(false);
              setNotifications(!notifications);
              window.scrollTo({ top: 0 });
            }}
          >
            <span className="quick-bar-icon">
              <Bell size={21} strokeWidth={notifications ? 2.1 : 1.7} />
              {late.length > 0 && (
                <small aria-label={`${n(late.length)} تنبيه`}>
                  {late.length > 99 ? "99+" : n(late.length)}
                </small>
              )}
            </span>
            <span className="quick-bar-label">التنبيهات</span>
          </button>
        )}
        <button
          type="button"
          className={"quick-bar-more" + (menu ? " active" : "")}
          aria-expanded={menu}
          aria-controls="crm-sidebar"
          onClick={() => setMenu(!menu)}
        >
          <span className="quick-bar-icon">
            <MoreHorizontal size={21} strokeWidth={menu ? 2.1 : 1.7} />
          </span>
          <span className="quick-bar-label">المزيد</span>
        </button>
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {modal === "create" && (
        <Intake
          data={data}
          {...(brand === "all" ? {} : { initialBrand: brand })}
          onClose={() => setModal(null)}
          onDone={async (id) => {
            await load();
            openTicket(id);
            setToast("تم تسجيل الشكوى");
          }}
        />
      )}
      {modal === "qr" && (
        <QRPanel
          branch={branches.find((b) => b.id === selected)!}
          brand={data.brands.find((b) => b.branches.some((x) => x.id === selected))!}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "two-step" && (
        <Modal title="التحقق بخطوتين" onClose={() => setModal(null)}>
          <TwoStepAccount required={!!data.policy.requireMfa} />
        </Modal>
      )}
      {modal === "telegram" && (
        <Modal title="حسابي على تيليجرام" onClose={() => setModal(null)}>
          <TelegramAccount />
        </Modal>
      )}
      {modal === "ticket" && ticket && (
        <TicketDetail
          ticket={ticket}
          data={data}
          busy={busy}
          mutate={mutate}
          reload={load}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
function TicketTable({
  tickets,
  onOpen,
  userName,
}: {
  tickets: Ticket[];
  onOpen: (id: string) => void;
  userName: (id: string) => string;
}) {
  if (!tickets.length)
    return <Empty title="لا توجد بلاغات تطابق العرض" detail="غيّر الفلاتر أو سجّل شكوى جديدة." />;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>البلاغ / الموضوع</th>
            <th>العلامة والفرع</th>
            <th>وقت الاستقبال</th>
            <th>الحالة</th>
            <th>المهلة التجريبية</th>
            <th>المسؤول</th>
            <th>
              <span className="sr-only">التفاصيل</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const status = risk(t);
            return (
              <tr key={t.id}>
                <td>
                  <button className="ticket-link" onClick={() => onOpen(t.id)}>
                    <span className="ticket-number" dir="ltr">
                      {t.number}
                    </span>
                    <b>{categories[t.category]}</b>
                  </button>
                  <span className="source-label">
                    {t.source === "PHONE_AGENT" ? <Phone size={11} /> : <QrCode size={11} />}{" "}
                    {t.source === "PHONE_AGENT" ? "تسجيل هاتفي" : "رمز QR"}{" "}
                    <span className={"priority " + t.priority}>{t.priority}</span>
                  </span>
                </td>
                <td>
                  <div className="table-brand">
                    <img src={"/logos/" + t.brand.logo} alt="" />
                    <span>
                      <b>{t.brand.name}</b>
                      <small>{t.branch?.name ?? "الفرع غير معروف"}</small>
                    </span>
                  </div>
                </td>
                <td>
                  <time dateTime={t.receivedAt}>{date(t.receivedAt)}</time>
                </td>
                <td>
                  <Badge
                    tone={
                      ["CLOSED", "RESOLVED"].includes(t.state)
                        ? "green"
                        : t.state === "NEW"
                          ? "burgundy"
                          : "amber"
                    }
                  >
                    {states[t.state]}
                  </Badge>
                </td>
                <td>
                  <span className={"sla " + status}>
                    {t.state === "CLOSED" || t.state === "RESOLVED" ? (
                      <>
                        <CheckCheck size={13} />
                        تمت المعالجة
                      </>
                    ) : (
                      <>
                        <Clock size={13} />
                        {status === "late"
                          ? "متجاوزة"
                          : status === "soon"
                            ? "تقترب المهلة"
                            : t.timers.length
                              ? "ضمن المهلة"
                              : "بانتظار السياسة"}
                      </>
                    )}
                  </span>
                </td>
                <td>
                  <span className="owner-name">{userName(t.communicationsOwner)}</span>
                </td>
                <td>
                  <button
                    className="icon-btn"
                    aria-label={"فتح " + t.number}
                    onClick={() => onOpen(t.id)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
/** The browser's local time now, as "YYYY-MM-DDTHH:MM" for a datetime-local input. */
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
function Intake({
  data,
  initialBrand,
  onClose,
  onDone,
}: {
  data: Data;
  onClose: () => void;
  onDone: (id: string) => void;
  initialBrand?: string;
}) {
  const [requestKey] = useState(() => crypto.randomUUID());
  const [brand, setBrand] = useState(initialBrand ?? data.brands[0]?.id ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [unknown, setUnknown] = useState(false),
    [duplicates, setDuplicates] = useState<{ number: string }[]>([]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    const b = form(e);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>(
        "tickets/phone",
        {
          ...b,
          whatsappConsent: b["whatsappConsent"] === "on",
          branchId: unknown ? null : b["branchId"],
          receivedAt: b["receivedAt"] ? new Date(b["receivedAt"]).toISOString() : undefined,
        },
        { headers: { "Idempotency-Key": requestKey } },
      );
      onDone(result.id);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <Modal title="تسجيل شكوى هاتفية" onClose={onClose} wide>
      <div className="intake-intro">
        <span className="square">
          <Headphones size={23} />
        </span>
        <div>
          <b>ابدأ البلاغ، وخلي المتابعة علينا.</b>
        </div>
        <Badge>PHONE</Badge>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="العلامة التجارية">
            <select name="brandId" value={brand} onChange={(e) => setBrand(e.target.value)}>
              {data.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الفرع">
            <select name="branchId" required={!unknown} disabled={unknown} key={brand}>
              <option value="">اختر الفرع</option>
              {data.brands
                .find((b) => b.id === brand)
                ?.branches.filter((b) => b.active)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </Field>
          <label className="checkbox full">
            <input
              type="checkbox"
              checked={unknown}
              onChange={(e) => setUnknown(e.target.checked)}
            />
            الفرع غير معروف
          </label>
          {unknown && (
            <Field label="سبب عدم معرفة الفرع" full>
              <input name="unknownReason" required maxLength={300} />
            </Field>
          )}
          <Field label="اسم العميل">
            <input name="name" required minLength={2} maxLength={100} autoComplete="off" />
          </Field>
          <Field label="رقم الجوال">
            <input
              name="phone"
              required
              type="tel"
              dir="ltr"
              placeholder="05xxxxxxxx"
              autoComplete="off"
              pattern="(\+?966|0)?5[0-9]{8}"
              onBlur={async (e) => {
                if (data.me.role !== "AGENT" && e.target.value.length >= 9) {
                  try {
                    setDuplicates(
                      await api<{ number: string }[]>("customers/search", {
                        phone: e.target.value,
                      }),
                    );
                  } catch {
                    /* Error is surfaced by the shared mutation handler. */
                  }
                }
              }}
            />
          </Field>
          {data.integrations?.whatsapp && (
            <label className="checkbox full">
              <input name="whatsappConsent" type="checkbox" />
              إرسال تأكيد واتساب بموافقة العميل
            </label>
          )}
          {duplicates.length > 0 && (
            <div className="notice full">
              يوجد سجل سابق لهذا الرقم: {duplicates.map((x) => x.number).join("، ")}. راجع قبل تسجيل
              حالة مكررة.
            </div>
          )}
          <ReasonPicker
            reasons={activeCategories()}
            label="سبب الشكوى"
            detailLabel="ما نوع المشكلة؟"
            detailPlaceholder="اكتب نوع المشكلة باختصار، مثل: مشكلة في الحجز"
          />
          <Field label="الأولوية">
            <select name="priority" defaultValue="P3">
              <option value="P3">P3 — عادية</option>
              <option value="P2">P2 — عالية</option>
              <option value="P1">P1 — حرجة / سلامة</option>
            </select>
          </Field>
          <Field label="تفاصيل المشكلة" full>
            <textarea
              name="description"
              required
              minLength={10}
              maxLength={4000}
              rows={4}
              placeholder="ما المشكلة؟ وما الإجراء المطلوب من الفرع؟"
            />
          </Field>
          <Field label="رقم الطلب الخارجي">
            <input name="externalOrder" required maxLength={100} dir="ltr" />
          </Field>
          <Field label="منصة الطلب">
            <select name="platform" defaultValue="" required>
              <option value="" disabled>
                اختر المنصة
              </option>
              {activePlatforms().map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="وقت استقبال الشكوى" full>
            <input name="receivedAt" type="datetime-local" required defaultValue={nowLocal()} />
          </Field>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <Submit busy={busy}>تسجيل الشكوى</Submit>
        </div>
      </form>
    </Modal>
  );
}
function TicketDetail({
  ticket: t,
  data,
  busy,
  mutate,
  reload,
  onClose,
}: {
  ticket: Ticket;
  data: Data;
  busy: boolean;
  mutate: (p: string, b?: unknown) => Promise<unknown>;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("timeline"),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false);
  const can = (p: string) => data.permissions.includes(p);
  const editable = data.me.role !== "AGENT" || agentInvolved(t, data.me.id);
  async function run(path: string, b: unknown) {
    setError("");
    try {
      await mutate(path, b);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title={t.number} onClose={onClose} wide>
      <div className="detail-summary">
        <div className="table-brand">
          <img src={"/logos/" + t.brand.logo} alt={t.brand.name} />
          <div>
            <h2>{categories[t.category]}</h2>
            <p>
              {t.brand.name} • {t.branch?.name ?? "الفرع غير معروف"}
            </p>
            <p>
              وردت: {date(t.receivedAt)} • المسؤول:{" "}
              {data.users.find((u) => u.id === t.resolutionOwner)?.name ?? "بانتظار إسناد الدعم"}
            </p>
          </div>
        </div>
        <Badge tone="amber">{states[t.state]}</Badge>
        <Badge tone={t.priority === "P1" ? "red" : "neutral"}>{t.priority}</Badge>
      </div>
      <CustomerCard t={t} canSee={can("pii")} />
      <ComplaintJourney ticket={t} />
      {t.branchBrief && (
        <section className="branch-brief">
          <h3>موجز التصعيد</h3>
          <p>{t.branchBrief}</p>
        </section>
      )}
      <p className="description">{t.description}</p>
      {!editable && <p className="notice">للعرض فقط؛ المعالجة لدى الموظف المسند.</p>}
      {editable && !["CEO", "OWNER"].includes(data.me.role) && (
        <ComplaintActionPanel key={t.id} ticket={t} data={data} busy={busy} mutate={mutate} />
      )}
      <details className="complaint-extra-details">
        <summary>تفاصيل الشكوى والتوقيت</summary>
        <div className="detail-facts">
          <div>
            <small>مصدر البلاغ</small>
            <b>{t.source === "PHONE_AGENT" ? "شكوى هاتفية" : "رمز QR"}</b>
          </div>
          <div>
            <small>وقت استقبال الشكوى</small>
            <b>{date(t.receivedAt)}</b>
          </div>
          <div>
            <small>مسؤول التواصل</small>
            <b>{data.users.find((u) => u.id === t.communicationsOwner)?.name ?? "غير مسند"}</b>
          </div>
          <div>
            <small>مسؤول المعالجة</small>
            <b>
              {data.users.find((u) => u.id === t.resolutionOwner)?.name ?? "بانتظار إسناد الدعم"}
            </b>
          </div>
          <div>
            <small>رقم الطلب الخارجي</small>
            <b dir="ltr">{t.externalOrder ?? "—"}</b>
          </div>
          <div>
            <small>العميل</small>
            <b>{t.customer?.name || "غير مسجل / محجوب"}</b>
            <span dir="ltr">{t.customer?.phone}</span>
            {t.customer?.email && <span dir="ltr">{t.customer.email}</span>}
          </div>
        </div>
        <div className="detail-facts">
          <div>
            <small>وقت التسجيل في CRM</small>
            <b>{date(t.createdAt)}</b>
          </div>
          <div>
            <small>بدء العمل</small>
            <b>{t.acknowledgedAt ? date(t.acknowledgedAt) : "بانتظار الاستلام"}</b>
          </div>
          <div>
            <small>وقت الإغلاق</small>
            <b>{t.closedAt ? date(t.closedAt) : "الشكوى لم تغلق بعد"}</b>
          </div>
        </div>
        <div className="timer-strip">
          {t.timers.map((timer) => (
            <div
              key={timer.id}
              className={
                timer.completedAt ? "done" : +new Date(timer.dueAt) < Date.now() ? "late" : ""
              }
            >
              <Clock size={14} />
              <b>
                {
                  { FIRST_ACTION: "أول إجراء", ACKNOWLEDGMENT: "بدء العمل", REMEDY: "المعالجة" }[
                    timer.milestone
                  ]
                }
              </b>
              <span>{timer.completedAt ? "مكتمل" : date(timer.dueAt)}</span>
            </div>
          ))}
        </div>
        <p className="hint">مهل تجريبية مقترحة؛ لا تمثل التزاماً معتمداً.</p>
      </details>
      <div className="queue-tabs detail-tabs">
        {[
          { id: "timeline", label: "السجل والإجراءات" },
          { id: "evidence", label: "المرفقات" },
          { id: "followup", label: "المتابعة" },
        ]
          .filter((s) => s.id !== "followup" || can("task"))
          .map((s) => (
            <button
              className={tab === s.id ? "current" : ""}
              onClick={() => setTab(s.id)}
              key={s.id}
            >
              {s.label}
            </button>
          ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tab === "timeline" && (
        <>
          <div className="timeline">
            {t.events.map((e) => (
              <article key={e.id}>
                <span className="timeline-dot" />
                <div>
                  <b>{eventNames[e.type] ?? e.type.replaceAll("_", " ")}</b>
                  <small>
                    {data.users.find((u) => u.id === e.actor)?.name ??
                      (e.actor === "SYSTEM" ? "النظام" : e.actor)}{" "}
                    • {date(e.createdAt)}
                  </small>
                  {e.note && <p>{e.note}</p>}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "evidence" && (
        <>
          <div className="attachment-grid">
            {t.attachments.map((f) => (
              <EvidenceLink key={f.id} id={f.id} alt="صورة إثبات للبلاغ">
                <small>{f.status === "CLEAN" ? "تم الفحص" : "بانتظار فحص الأمان"}</small>
              </EvidenceLink>
            ))}
          </div>
          {editable && can("comment") && t.attachments.length < 3 && (
            <label className="upload-zone">
              <Upload size={24} />
              <b>{uploading ? "جارٍ رفع الصور…" : "أرفق صوراً للطلب أو إثبات المعالجة"}</b>
              <small>JPG، PNG، WebP • 3 صور كحد أقصى • 5 ميغابايت للصورة</small>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={uploading}
                onChange={async (e) => {
                  if (!e.target.files?.length) return;
                  const f = new FormData();
                  Array.from(e.target.files).forEach((x) => f.append("files", x));
                  setUploading(true);
                  try {
                    await api(`tickets/${t.id}/attachments`, undefined, {
                      method: "POST",
                      body: f,
                    });
                    await reload();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                  setUploading(false);
                }}
              />
            </label>
          )}
        </>
      )}
      {tab === "followup" && (
        <>
          {editable && can("task") && (
            <form
              className="action-form"
              onSubmit={async (e) => {
                const b = form(e);
                await run("tasks", {
                  ...b,
                  ticketId: t.id,
                  dueAt: new Date(b["dueAt"] ?? "").toISOString(),
                });
              }}
            >
              <h3>إضافة مهمة متابعة</h3>
              <div className="form-grid">
                <Field label="المسؤول">
                  <select name="owner" defaultValue={data.me.id}>
                    {data.users
                      .filter((u) =>
                        data.me.role === "AGENT"
                          ? u.id === data.me.id
                          : ["AGENT", "SHIFT_LEAD", "MARKETING_MANAGER"].includes(u.role),
                      )
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="موعد المتابعة">
                  <input name="dueAt" type="datetime-local" required />
                </Field>
                <Field label="المطلوب" full>
                  <input name="note" required minLength={3} maxLength={500} />
                </Field>
              </div>
              <Submit busy={busy}>إضافة المتابعة</Submit>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}
function CustomerLookup({ onOpen }: { onOpen: (id: string) => void }) {
  const [result, setResult] = useState<
      | {
          id: string;
          number: string;
          state: string;
          customer: { name: string; phone: string } | null;
        }[]
      | null
    >(null),
    [error, setError] = useState("");
  return (
    <div className="padded">
      <form
        className="lookup-form"
        onSubmit={async (e) => {
          const b = form(e);
          try {
            setResult(await api("customers/search", { phone: b["phone"] }));
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <Field label="رقم الجوال">
          <input
            name="phone"
            type="tel"
            required
            minLength={9}
            maxLength={15}
            dir="ltr"
            placeholder="05xxxxxxxx"
          />
        </Field>
        <button className="primary">
          بحث <Search size={17} />
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {result?.map((t) => (
        <button className="notification-item" key={t.id} onClick={() => onOpen(t.id)}>
          <b>{t.customer?.name || "عميل"}</b>
          <span dir="ltr">{t.number}</span>
          <Badge>{states[t.state]}</Badge>
        </button>
      ))}
      {result?.length === 0 && <Empty title="لا توجد نتائج ضمن نطاقك" />}
    </div>
  );
}
