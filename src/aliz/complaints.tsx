import { useState } from "react";
import {
  QrCode,
  Phone,
  Search,
  MapPin,
  Clock,
  ArrowLeft,
  UserRound,
  Columns3,
  List,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Data, Ticket, categories, states, date, n, risk } from "./types";
import { complaintStages, complaintStage, nextComplaintAction, elapsed } from "./workflow";
import { Empty } from "./ui";
export function ComplaintsWorkspace({
  data,
  brand,
  onOpen,
  onPhone,
  onQR,
}: {
  data: Data;
  brand: string;
  onOpen: (id: string) => void;
  onPhone: () => void;
  onQR: () => void;
}) {
  const [mode, setMode] = useState("board"),
    [channel, setChannel] = useState("all"),
    [branch, setBranch] = useState("all"),
    [queue, setQueue] = useState("all"),
    [search, setSearch] = useState("");
  const scoped = data.tickets.filter((t) => brand === "all" || t.brandId === brand),
    branches = data.brands
      .filter((b) => brand === "all" || b.id === brand)
      .flatMap((b) => b.branches.map((branch) => ({ ...branch, brandName: b.name })));
  const tickets = scoped
    .filter(
      (t) =>
        (channel === "all" || t.source === channel) &&
        (branch === "all" || t.branchId === branch) &&
        (!search ||
          [t.number, t.branch?.name, t.brand.name, t.externalOrder, categories[t.category]]
            .join(" ")
            .includes(search)) &&
        (queue === "all" ||
          (queue === "mine" &&
            (t.communicationsOwner === data.me.id || t.resolutionOwner === data.me.id)) ||
          (queue === "escalated" && t.escalated && t.state !== "CLOSED") ||
          (queue === "unassigned" &&
            (t.communicationsOwner === "UNASSIGNED" ||
              !t.resolutionOwner ||
              t.resolutionOwner === t.branchId) &&
            t.state !== "CLOSED") ||
          (queue === "late" && risk(t) === "late" && t.state !== "CLOSED")),
    )
    .sort(
      (a, b) =>
        a.priority.localeCompare(b.priority) || +new Date(a.receivedAt) - +new Date(b.receivedAt),
    );
  return (
    <div className="complaints-workspace">
      <section className="intake-paths" aria-label="قنوات استقبال الشكاوى">
        <div>
          <span className="path-icon">
            <QrCode size={24} />
          </span>
          <div>
            <b>من العميل مباشرة</b>
          </div>
          <strong>{n(scoped.filter((t) => t.source === "PUBLIC_QR").length)}</strong>
          {data.permissions.includes("configure") && (
            <button className="text-btn" onClick={onQR}>
              رموز الفروع <ArrowLeft size={16} />
            </button>
          )}
        </div>
        <div>
          <span className="path-icon">
            <Phone size={23} />
          </span>
          <div>
            <b>من مركز الاتصال</b>
          </div>
          <strong>{n(scoped.filter((t) => t.source === "PHONE_AGENT").length)}</strong>
          {data.permissions.includes("create") && (
            <button className="text-btn" onClick={onPhone}>
              تسجيل شكوى <ArrowLeft size={16} />
            </button>
          )}
        </div>
      </section>
      <section className="panel complaint-work-panel">
        <div className="panel-head">
          <div>
            <h2>
              مسار الشكاوى <span className="count-badge">{n(tickets.length)}</span>
            </h2>
          </div>
          <div className="view-switch" aria-label="طريقة عرض الشكاوى">
            <button className={mode === "board" ? "selected" : ""} onClick={() => setMode("board")}>
              <Columns3 size={16} />
              مسار العمل
            </button>
            <button className={mode === "list" ? "selected" : ""} onClick={() => setMode("list")}>
              <List size={16} />
              السجل والتوقيت
            </button>
          </div>
        </div>
        <div className="complaint-filters">
          <label className="search">
            <Search size={17} />
            <input
              aria-label="البحث في مسار الشكاوى"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="رقم الشكوى، الفرع، رقم الطلب…"
            />
          </label>
          <select
            aria-label="فرع الشكوى"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="all">كل الفروع</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.brandName} — {b.name}
              </option>
            ))}
          </select>
          <select
            aria-label="قائمة عمل الشكاوى"
            value={queue}
            onChange={(e) => setQueue(e.target.value)}
          >
            <option value="all">كل الشكاوى</option>
            <option value="mine">مسندة إليّ</option>
            <option value="unassigned">بانتظار الإسناد</option>
            <option value="late">متجاوزة المهلة</option>
            <option value="escalated">الشكاوى المصعّدة</option>
          </select>
        </div>
        <div className="channel-tabs" aria-label="مصدر الشكوى">
          {[
            { id: "all", name: "كل المصادر" },
            { id: "PUBLIC_QR", name: "QR من العميل", icon: QrCode },
            { id: "PHONE_AGENT", name: "الهاتف / مركز الاتصال", icon: Phone },
          ].map((c) => (
            <button
              key={c.id}
              className={channel === c.id ? "selected" : ""}
              onClick={() => setChannel(c.id)}
            >
              {c.icon && <c.icon size={15} />} {c.name}
              <span>{n(scoped.filter((t) => c.id === "all" || t.source === c.id).length)}</span>
            </button>
          ))}
        </div>
        {mode === "board" ? (
          <div className="workflow-board" aria-label="لوحة مراحل الشكوى">
            {complaintStages.map((stage, index) => (
              <section key={stage.id} className={"workflow-lane lane-" + stage.id}>
                <header>
                  <span className="lane-step">{n(index + 1)}</span>
                  <h3>{stage.label}</h3>
                  <span>{n(tickets.filter((t) => complaintStage(t) === stage.id).length)}</span>
                </header>

                <div className="lane-cards">
                  {tickets
                    .filter((t) => complaintStage(t) === stage.id)
                    .map((t) => {
                      const next = nextComplaintAction(t),
                        due = t.timers
                          .filter((x) => !x.completedAt)
                          .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))[0];
                      return (
                        <button
                          className="workflow-card"
                          key={t.id}
                          onClick={() => onOpen(t.id)}
                          aria-label={`فتح الشكوى ${t.number} — ${t.branch?.name ?? "غير محدد"}`}
                        >
                          <span className="work-card-top">
                            <span dir="ltr">{t.number}</span>
                            <span className={"priority " + t.priority}>{t.priority}</span>
                          </span>
                          <b className="work-card-subject">{categories[t.category]}</b>
                          <span className="work-card-branch">
                            <MapPin size={14} />
                            {t.branch?.name ?? "بانتظار تحديد الفرع"}
                          </span>
                          <span className="work-card-brand">
                            <img src={"/logos/" + t.brand.logo} alt="" />
                            {t.brand.name}
                            <span className="work-source">
                              {t.source === "PUBLIC_QR" ? (
                                <QrCode size={13} />
                              ) : (
                                <Phone size={13} />
                              )}{" "}
                              {t.source === "PUBLIC_QR" ? "QR" : "الهاتف"}
                            </span>
                          </span>
                          <span className="work-card-time">
                            <Clock size={13} />
                            وردت: {date(t.receivedAt)}
                          </span>
                          <span className="work-card-time">
                            {t.closedAt ? "مدة الشكوى" : "عمر الشكوى"}:{" "}
                            {elapsed(t.receivedAt, t.closedAt)}
                          </span>
                          <span className="work-card-owner">
                            <UserRound size={13} />
                            {data.users.find((u) => u.id === t.resolutionOwner)?.name ??
                              "بانتظار إسناد الدعم"}
                          </span>
                          {t.escalated && t.state !== "CLOSED" && (
                            <span className="badge red">مصعّدة • أولوية متابعة</span>
                          )}
                          {t.state === "CLOSED" && (
                            <span className="badge neutral">تم الإغلاق</span>
                          )}
                          {t.state === "RESOLVED" && !!t.customerConfirmedAt && (
                            <span className="badge amber">
                              تأكيد العميل محفوظ • بانتظار الطلب المالي
                            </span>
                          )}
                          {due && (
                            <span className={"work-due " + risk(t)}>
                              {risk(t) === "late" ? (
                                <AlertTriangle size={13} />
                              ) : (
                                <Clock size={13} />
                              )}
                              الموعد التجريبي: {date(due.dueAt)}
                            </span>
                          )}
                          <span className="work-next">
                            {t.state === "CLOSED" ? (
                              <CheckCircle2 size={15} />
                            ) : (
                              <ArrowLeft size={15} />
                            )}{" "}
                            {next.label}
                          </span>
                        </button>
                      );
                    })}
                  {!tickets.some((t) => complaintStage(t) === stage.id) && (
                    <div className="lane-empty">لا توجد شكاوى في هذه المرحلة</div>
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : tickets.length ? (
          <div className="table-scroll">
            <table className="complaint-register">
              <thead>
                <tr>
                  <th>الشكوى</th>
                  <th>العلامة / اسم الفرع</th>
                  <th>المصدر</th>
                  <th>وقت الاستقبال</th>
                  <th>العمر</th>
                  <th>الحالة</th>
                  <th>الخطوة التالية</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button className="ticket-link" onClick={() => onOpen(t.id)}>
                        <span dir="ltr">{t.number}</span>
                        <b>{categories[t.category]}</b>
                      </button>
                    </td>
                    <td>
                      <b>{t.branch?.name ?? "غير محدد"}</b>
                      <small className="block">{t.brand.name}</small>
                    </td>
                    <td>{t.source === "PUBLIC_QR" ? "QR من العميل" : "مركز الاتصال"}</td>
                    <td>
                      <time dateTime={t.receivedAt}>{date(t.receivedAt)}</time>
                    </td>
                    <td>{elapsed(t.receivedAt, t.closedAt)}</td>
                    <td>
                      <span className="badge">{states[t.state]}</span>
                    </td>
                    <td>
                      <button className="text-btn" onClick={() => onOpen(t.id)}>
                        {nextComplaintAction(t).label}
                        <ArrowLeft size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="لا توجد شكاوى مطابقة" detail="غيّر المصدر أو الفرع أو قائمة العمل." />
        )}
      </section>
    </div>
  );
}
export function ComplaintJourney({ ticket: t }: { ticket: Ticket }) {
  const points = [
    { label: "استقبال الشكوى", time: t.receivedAt },
    {
      label: "الإسناد",
      time: t.events.filter((e) => ["ASSIGN", "AUTO_ASSIGNED", "ESCALATION_ROUTED"].includes(e.type)).at(-1)
        ?.createdAt,
    },
    { label: "جارٍ العمل", time: t.acknowledgedAt },
    {
      label: "التواصل مع العميل",
      time: t.actionCompletedAt
        ? t.events
            .filter(
              (e) =>
                e.type === "CONTACT_RECORDED" &&
                +new Date(e.createdAt) >= +new Date(t.actionCompletedAt!),
            )
            .at(-1)?.createdAt
        : undefined,
    },
    { label: "تم الحل", time: t.closedAt },
  ];
  return (
    <section className="complaint-journey" aria-label="المسار الزمني للشكوى">
      <div className="journey-title">
        <h3>رحلة الشكوى</h3>
        <span>
          {t.closedAt ? "مدة الشكوى" : "عمر الشكوى"}: {elapsed(t.receivedAt, t.closedAt)} • توقيت
          الرياض
        </span>
      </div>
      <ol>
        {points.map((p, i) => (
          <li key={p.label} className={p.time ? "complete" : ""}>
            <span>{p.time ? <CheckCircle2 size={15} /> : n(i + 1)}</span>
            <b>{p.label}</b>
            <time dateTime={p.time ?? undefined}>{p.time ? date(p.time) : "لم يسجل بعد"}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
