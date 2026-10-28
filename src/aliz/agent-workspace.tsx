import { useState, useEffect } from "react";
import { ArrowLeft, Clock, Headphones, MessageSquare, Phone, Search } from "lucide-react";
import { Data, Ticket, categories, date, n, risk, states, api } from "./types";
import { Empty } from "./ui";
export function agentQueue(t: Ticket, id: string) {
  if (t.state === "CLOSED") return "closed";
  if (t.state === "RESOLVED" && t.communicationsOwner === id) return "contact";
  if (t.escalated && t.resolutionOwner !== id) return "escalated";
  if (t.resolutionOwner === id) return "working";
  if (t.resolutionOwner && t.resolutionOwner !== t.branchId) return "tracking";
  return "waiting";
}
export function AgentWorkspace({
  data,
  brand,
  onOpen,
  onPhone,
  browseAll = false,
}: {
  data: Data;
  brand: string;
  onOpen: (id: string) => void;
  onPhone: () => void;
  browseAll?: boolean;
}) {
  const [queue, setQueue] = useState(browseAll ? "all" : "open"),
    [search, setSearch] = useState(""),
    [term, setTerm] = useState(""),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [remote, setRemote] = useState<{ tickets: Ticket[]; total: number; nextOffset: number | null }>(
      { tickets: [], total: 0, nextOffset: null },
    ),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!browseAll) return;
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError("");
    if (offset === 0) setRemote({ tickets: [], total: 0, nextOffset: null });
    const query = new URLSearchParams({
      q: term,
      brandId: brand,
      filter: queue,
      offset: String(offset),
    });
    api<typeof remote>("tickets/search?" + query, undefined, { signal: controller.signal })
      .then((result) => {
        if (alive)
          setRemote((previous) => ({
            ...result,
            tickets: offset ? [...previous.tickets, ...result.tickets] : result.tickets,
          }));
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
  }, [browseAll, brand, term, queue, offset, revision]);
  const scoped = data.tickets.filter(
    (t) =>
      (brand === "all" || t.brandId === brand) &&
      (t.resolutionOwner === data.me.id ||
        t.communicationsOwner === data.me.id ||
        t.creator === data.me.id),
  );
  const count = (key: string) => scoped.filter((t) => agentQueue(t, data.me.id) === key).length;
  const tickets = browseAll
    ? remote.tickets
    : scoped
        .filter(
          (t) =>
            (queue === "all" ||
              (queue === "open" ? t.state !== "CLOSED" : agentQueue(t, data.me.id) === queue)) &&
            (!search ||
              [
                t.number,
                t.brand.name,
                t.branch?.name,
                t.externalOrder,
                t.customer?.name,
                t.customer?.phone,
                categories[t.category],
              ]
                .join(" ")
                .includes(search.trim())),
        )
        .sort(
          (a, b) =>
            a.priority.localeCompare(b.priority) ||
            Number(risk(b) === "late") - Number(risk(a) === "late") ||
            +new Date(a.receivedAt) - +new Date(b.receivedAt),
        );
  const queues = [
    { id: "open", label: browseAll ? "الشكاوى المفتوحة" : "عملي المفتوح" },
    { id: "working", label: "جارٍ العمل" },
    { id: "contact", label: "التواصل مع العميل" },
    { id: "waiting", label: "بانتظار الإسناد" },
    { id: "escalated", label: "قيد التصعيد" },
    ...(!browseAll ? [{ id: "tracking", label: "للمتابعة فقط" }] : []),
    { id: "closed", label: "تم الحل" },
    { id: "all", label: browseAll ? "جميع الشكاوى، بما فيها المحلولة" : "السجل الكامل" },
  ];
  return (
    <div className="agent-workspace">
      {!browseAll && (
        <section className="agent-work-counters" aria-label="ملخص عملي">
          {[
            { id: "working", label: "بانتظار البدء أو جارٍ العمل", icon: Headphones },
            { id: "contact", label: "تحتاج تواصلاً مع العميل", icon: MessageSquare },
            { id: "waiting", label: "سجلتها وبانتظار الإسناد", icon: Clock },
          ].map((c) => (
            <button
              className={queue === c.id ? "selected" : ""}
              key={c.id}
              onClick={() => setQueue(c.id)}
            >
              <c.icon size={22} />
              <div>
                <b>{n(count(c.id))}</b>
                <span>{c.label}</span>
              </div>
              <ArrowLeft size={17} />
            </button>
          ))}
        </section>
      )}
      <section className="panel agent-queue">
        <div className="panel-head">
          <div>
            <h2>
              {browseAll ? "جميع شكاوى العملاء" : "قائمة عملي"}{" "}
              <span className="count-badge">{n(browseAll ? remote.total : tickets.length)}</span>
            </h2>
          </div>
        </div>
        <form
          className="agent-queue-controls"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setTerm(search.trim());
            setRevision((r) => r + 1);
          }}
        >
          <label className="qr-search">
            <Search size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={browseAll ? "البحث في جميع الشكاوى" : "البحث في شكاواي"}
              placeholder={
                browseAll
                  ? "رقم الشكوى، الجوال، رقم الطلب، العلامة أو الفرع"
                  : "رقم الشكوى، الفرع أو رقم الطلب"
              }
            />
          </label>
          <select
            aria-label="حالة الشكاوى"
            value={queue}
            onChange={(e) => {
              setOffset(0);
              setQueue(e.target.value);
            }}
          >
            {queues.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
          {browseAll && (
            <button type="submit" className="primary" disabled={loading}>
              بحث
            </button>
          )}
        </form>
        {error && (
          <div className="padded" role="alert">
            <p className="error">{error}</p>
            <button className="secondary" onClick={() => setRevision((r) => r + 1)}>
              إعادة المحاولة
            </button>
          </div>
        )}
        {loading && !tickets.length ? (
          <p className="padded" role="status">
            جارٍ البحث في الشكاوى…
          </p>
        ) : !tickets.length && !error ? (
          <Empty
            title={search ? "لا توجد شكاوى تطابق البحث" : "لا توجد شكاوى في هذه القائمة"}
            detail={
              queue === "waiting"
                ? "ستظهر الشكاوى الهاتفية التي سجلتها حتى يسندها قائد الفريق."
                : browseAll
                  ? "غيّر البحث أو الحالة. يمكنك البحث برقم الجوال أو الشكوى أو الطلب."
                  : "ستظهر هنا الشكاوى المسندة إليك أو التي سجلتها هاتفياً."
            }
            action={
              <button className="secondary" onClick={onPhone}>
                <Phone size={16} />
                تسجيل شكوى هاتفية
              </button>
            }
          />
        ) : (
          <div className="agent-ticket-list">
            {tickets.map((t) => {
              const stage = agentQueue(t, data.me.id),
                late = t.state !== "CLOSED" && risk(t) === "late";
              const next =
                stage === "contact"
                  ? "التواصل مع العميل"
                  : stage === "working"
                    ? t.state === "ASSIGNED"
                      ? "بدء العمل"
                      : "متابعة المعالجة"
                    : stage === "closed"
                      ? "عرض السجل"
                      : stage === "escalated"
                        ? "متابعة التصعيد"
                        : "عرض الشكوى";
              return (
                <article
                  className={"agent-ticket " + (t.priority === "P1" ? "urgent" : "")}
                  key={t.id}
                >
                  <div className="agent-ticket-heading">
                    <strong dir="ltr">{t.number}</strong>
                    <span className={"badge " + (t.priority === "P1" ? "red" : "neutral")}>
                      {t.priority === "P1" ? "حرجة" : t.priority === "P2" ? "عالية" : "عادية"}
                    </span>
                    <span className="badge neutral">
                      {browseAll
                        ? states[t.state]
                        : stage === "escalated"
                          ? "قيد التصعيد"
                          : stage === "waiting"
                            ? "بانتظار الإسناد"
                            : stage === "tracking"
                              ? "للمتابعة فقط"
                              : states[t.state]}
                    </span>
                    {late && (
                      <span className="agent-overdue">
                        <Clock size={13} />
                        تحتاج انتباهك
                      </span>
                    )}
                  </div>
                  <div className="agent-ticket-body">
                    <img src={"/logos/" + t.brand.logo} alt={t.brand.name} />
                    <div>
                      <h3>{categories[t.category]}</h3>
                      <p>
                        {t.brand.name} — {t.branch?.name ?? "لم يُحدد الفرع"}
                      </p>
                      <small>
                        استُقبلت {date(t.receivedAt)}
                        {t.externalOrder && " · الطلب " + t.externalOrder}
                      </small>
                    </div>
                    <button className="secondary" onClick={() => onOpen(t.id)}>
                      {next}
                      <ArrowLeft size={16} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      {browseAll && remote.nextOffset !== null && (
        <div className="padded">
          <button
            className="secondary"
            disabled={loading}
            onClick={() => setOffset(remote.nextOffset!)}
          >
            {loading ? "جارٍ التحميل…" : "عرض المزيد من الشكاوى"}
          </button>
        </div>
      )}
    </div>
  );
}
