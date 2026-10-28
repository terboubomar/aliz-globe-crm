import { useEffect, useState, type KeyboardEvent } from "react";
import {
  Building2,
  UserRound,
  Plug,
  History,
  MessageCircle,
  Send,
  ChevronLeft,
  Users,
  QrCode,
  CalendarDays,
  RefreshCw,
  Search,
} from "lucide-react";
import { api, date, eventNames, n, roleNames, type Data } from "./types";
import { Field, Empty } from "./ui";
import { canOpenView } from "./access";
import { WhatsAppIntegration } from "./whatsapp-integration";
import { TelegramIntegration } from "./telegram-integration";

type Section = "general" | "integrations" | "audit";
export function SettingsWorkspace({
  data,
  onRole,
  onNavigate,
  onMutate,
}: {
  data: Data;
  onRole: (id: string) => void;
  onNavigate: (view: string) => void;
  onMutate: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const [section, setSection] = useState<Section>("general"),
    [channel, setChannel] = useState<"whatsapp" | "telegram">("whatsapp");
  const sections = [
    { id: "general" as const, label: "عام", icon: Building2 },
    ...(data.me.role === "SUPER_ADMIN"
      ? [{ id: "integrations" as const, label: "التكاملات", icon: Plug }]
      : []),
    ...(data.permissions.includes("audit") && ["SUPER_ADMIN", "ADMIN"].includes(data.me.role)
      ? [{ id: "audit" as const, label: "سجل التدقيق", icon: History }]
      : []),
  ];
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offset = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? sections.length - 1
          : offset
            ? (index + offset + sections.length) % sections.length
            : null;
    if (next === null) return;
    event.preventDefault();
    setSection(sections[next]!.id);
    document.getElementById("settings-tab-" + sections[next]!.id)?.focus();
  }
  const shortcuts = [
    { view: "users", label: "المستخدمون والصلاحيات", icon: Users },
    { view: "branches", label: "العلامات والفروع", icon: Building2 },
    { view: "qr", label: "رموز الفروع QR", icon: QrCode },
    { view: "schedule", label: "جدولة الفريق", icon: CalendarDays },
  ].filter((item) => canOpenView(item.view, data.permissions, data.me.role));
  return (
    <div className="settings-workspace">
      <div className="settings-tabs" role="tablist" aria-label="أقسام الإعدادات">
        {sections.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            id={"settings-tab-" + id}
            role="tab"
            aria-selected={section === id}
            aria-controls={"settings-content-" + id}
            tabIndex={section === id ? 0 : -1}
            onClick={() => setSection(id)}
            onKeyDown={(event) => moveTab(event, index)}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>
      <div
        id={"settings-content-" + section}
        role="tabpanel"
        aria-labelledby={"settings-tab-" + section}
        tabIndex={0}
        className="settings-content"
      >
        {section === "general" && (
          <>
            <div className="settings-general-grid">
              <section className="panel settings-company">
                <div className="panel-head">
                  <h2>
                    <Building2 size={18} />
                    المنشأة
                  </h2>
                  <span className={"badge " + (data.demo ? "neutral" : "green")}>
                    {data.demo ? "بيئة تجريبية" : "تشغيل فعلي"}
                  </span>
                </div>
                <div className="settings-company-identity">
                  <img src="/logos/aliz.webp" alt="أليز غلوب" />
                  <div>
                    <h3>أليز غلوب</h3>
                    <span>Aliz Globe Company</span>
                  </div>
                </div>
                <dl className="settings-facts">
                  <div>
                    <dt>العلامات المتاحة</dt>
                    <dd>{n(data.brands.length)}</dd>
                  </div>
                  <div>
                    <dt>المنطقة الزمنية</dt>
                    <dd>
                      الرياض <span dir="ltr">(UTC+3)</span>
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="panel settings-account-card">
                <div className="panel-head">
                  <h2>
                    <UserRound size={18} />
                    حسابي
                  </h2>
                </div>
                <div className="settings-person">
                  <span className="avatar">{data.me.name.slice(0, 1)}</span>
                  <div>
                    <h3>{data.me.name}</h3>
                    <span>{roleNames[data.me.role] ?? data.me.role}</span>
                  </div>
                </div>
                <dl className="settings-facts">
                  <div>
                    <dt>نطاق الوصول</dt>
                    <dd>
                      {data.me.role === "SUPER_ADMIN"
                        ? "جميع العلامات والفروع"
                        : `${n(data.brands.length)} علامات`}
                    </dd>
                  </div>
                  <div>
                    <dt>تسجيل الدخول</dt>
                    <dd>
                      {data.authMode === "password"
                        ? "البريد وكلمة المرور"
                        : data.authMode === "oidc"
                          ? "الهوية المؤسسية"
                          : "حساب تجريبي"}
                    </dd>
                  </div>
                </dl>
                {data.demo && data.authMode === "demo" && (
                  <div className="padded">
                    <Field label="تجربة دور آخر">
                      <select value={data.me.id} onChange={(event) => onRole(event.target.value)}>
                        {data.users.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name} — {roleNames[user.role]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                )}
              </section>
            </div>
            {data.me.role === "SUPER_ADMIN" && (
              <PublicIntakeSetting data={data} onMutate={onMutate} />
            )}
            {shortcuts.length > 0 && (
              <section className="panel settings-management">
                <div className="panel-head">
                  <h2>إدارة النظام</h2>
                </div>
                <div className="settings-shortcuts">
                  {shortcuts.map(({ view, label, icon: Icon }) => (
                    <button key={view} onClick={() => onNavigate(view)}>
                      <span className="settings-shortcut-icon">
                        <Icon size={20} />
                      </span>
                      <span>{label}</span>
                      <ChevronLeft size={17} />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        {section === "integrations" && data.me.role === "SUPER_ADMIN" && (
          <>
            <div className="settings-channels" role="group" aria-label="اختيار التكامل">
              <button aria-pressed={channel === "whatsapp"} onClick={() => setChannel("whatsapp")}>
                <span className="settings-channel-icon">
                  <MessageCircle size={24} />
                </span>
                <span>
                  <b>واتساب</b>
                  <small>تأكيد الشكوى للعميل</small>
                </span>
                <ChevronLeft size={18} />
              </button>
              <button aria-pressed={channel === "telegram"} onClick={() => setChannel("telegram")}>
                <span className="settings-channel-icon">
                  <Send size={24} />
                </span>
                <span>
                  <b>تيليجرام</b>
                  <small>تنبيهات المسؤول والفريق</small>
                </span>
                <ChevronLeft size={18} />
              </button>
            </div>
            {channel === "whatsapp" ? <WhatsAppIntegration /> : <TelegramIntegration />}
          </>
        )}
        {section === "audit" &&
          data.permissions.includes("audit") &&
          ["SUPER_ADMIN", "ADMIN"].includes(data.me.role) && <AuditSettings data={data} />}
      </div>
    </div>
  );
}
type Audit = { id: string; actor: string; action: string; entityId: string; createdAt: string };
function AuditSettings({ data }: { data: Data }) {
  const [rows, setRows] = useState<Audit[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      setRows(await api<Audit[]>("audit"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const actorName = (id: string) =>
    data.users.find((user) => user.id === id)?.name ??
    (id === data.me.id ? data.me.name : id === "SYSTEM" ? "النظام" : id);
  const actionName = (action: string) =>
    eventNames[action] ??
    (
      {
        TELEGRAM_LINKED: "ربط حساب تيليجرام",
        TELEGRAM_DISCONNECTED: "إلغاء ربط تيليجرام",
        SCOPED_PII_READ: "عرض بيانات العملاء",
        USER_CREATED: "إضافة مستخدم",
        USER_ACCESS_UPDATED: "تعديل صلاحيات مستخدم",
        USER_ENABLED: "تفعيل مستخدم",
        USER_DISABLED: "إيقاف مستخدم",
      } as Record<string, string>
    )[action] ??
    action;
  const visible = rows?.filter((row) =>
    [actionName(row.action), actorName(row.actor), row.entityId]
      .join(" ")
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <section className="panel settings-audit">
      <div className="panel-head">
        <div>
          <h2>سجل التدقيق</h2>
          <p>آخر 200 إجراء</p>
        </div>
        <button className="secondary" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={16} className={busy ? "spin" : ""} />
          {busy ? "جارٍ التحميل…" : "تحديث"}
        </button>
      </div>
      <div className="settings-audit-search">
        <Search size={17} />
        <input
          aria-label="البحث في سجل التدقيق"
          placeholder="ابحث بالإجراء أو الحساب أو المرجع"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {rows && <span>{n(visible?.length ?? 0)} إجراء</span>}
      </div>
      {error && (
        <p className="error padded" role="alert">
          {error}
        </p>
      )}
      {!rows && busy && (
        <p className="padded" role="status">
          جارٍ تحميل السجل…
        </p>
      )}
      {visible &&
        (visible.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الإجراء</th>
                  <th>الحساب</th>
                  <th>المرجع</th>
                  <th>التوقيت</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>{actionName(row.action)}</td>
                    <td>{actorName(row.actor)}</td>
                    <td>
                      <bdi>
                        {data.tickets.find((ticket) => ticket.id === row.entityId)?.number ??
                          row.entityId}
                      </bdi>
                    </td>
                    <td>{date(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title={search ? "لا توجد نتائج مطابقة" : "لا توجد إجراءات مسجلة"} />
        ))}
    </section>
  );
}

/** Super admin switch for customer complaints through branch QR codes (audited server-side). */
function PublicIntakeSetting({
  data,
  onMutate,
}: {
  data: Data;
  onMutate: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const on = data.policy.publicIntake;
  const [confirming, setConfirming] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      await onMutate("settings/public-intake", { enabled });
      setConfirming(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-intake">
      <div className="panel-head">
        <h2>
          <QrCode size={18} />
          شكاوى العملاء عبر رموز QR
        </h2>
        <span className={"badge " + (on ? "green" : "neutral")}>{on ? "مفعّل" : "متوقف"}</span>
      </div>
      <div className="padded settings-intake-body">
        <p>
          {on
            ? "يستقبل النظام الآن شكاوى العملاء من رموز QR في الفروع المفعلة."
            : "رموز QR تعمل، لكن نموذج العميل يعرض «الرابط غير متاح» حتى تفعيل الاستقبال."}
        </p>
        {confirming ? (
          <>
            <p className="settings-intake-warning">
              قبل التفعيل: تأكد من اعتماد إشعار الخصوصية الظاهر للعميل وسياسة الاحتفاظ بالبيانات
              (القرار D07). سيُسجَّل التفعيل في سجل التدقيق.
            </p>
            <div className="settings-intake-actions">
              <button className="primary" disabled={busy} onClick={() => save(true)}>
                تأكيد التفعيل
              </button>
              <button className="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                إلغاء
              </button>
            </div>
          </>
        ) : (
          <div className="settings-intake-actions">
            {on ? (
              <button className="secondary" disabled={busy} onClick={() => save(false)}>
                إيقاف الاستقبال
              </button>
            ) : (
              <button className="primary" disabled={busy} onClick={() => setConfirming(true)}>
                تفعيل الاستقبال
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
