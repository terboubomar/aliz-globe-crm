import { useState, useEffect } from "react";
import { AlertTriangle, Clock, Headphones, MessageSquare, Phone, Search } from "lucide-react";
import { Data, Ticket, categories, n, risk, states, api } from "./types";
import { Empty } from "./ui";
import { AttentionStrip, CaseRow, DashHello, KpiCards } from "./dashboard-bits";
import { riyadhDay } from "./schedule-time";
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
  const lateCount = scoped.filter((t) => t.state !== "CLOSED" && risk(t) === "late").length;
  const openCount = scoped.filter((t) => t.state !== "CLOSED").length;
  const today = riyadhDay(new Date());
  const shift = data.shifts.find(
    (x) => x.userId === data.me.id && !x.cancelledAt && !x.dayOff && riyadhDay(x.start) === today,
  );
  const hm = (iso: string) =>
    new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Riyadh",
    }).format(new Date(iso));
  const helloLine =
    (openCount
      ? `لديك ${n(openCount)} شكاوى مفتوحة${lateCount ? `، منها ${n(lateCount)} متأخرة` : ""}.`
      : "لا توجد شكاوى مفتوحة عليك الآن.") +
    (shift ? ` ورديتك اليوم ${hm(shift.start)} – ${hm(shift.end)}.` : "");
  const tickets = browseAll
    ? remote.tickets
    : scoped
        .filter(
          (t) =>
            (queue === "all" ||
              (queue === "open"
                ? t.state !== "CLOSED"
                : queue === "late"
                  ? t.state !== "CLOSED" && risk(t) === "late"
                  : agentQueue(t, data.me.id) === queue)) &&
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
    ...(!browseAll ? [{ id: "late", label: "متأخرة عن المهلة" }] : []),
    { id: "waiting", label: "بانتظار الإسناد" },
    { id: "escalated", label: "قيد التصعيد" },
    ...(!browseAll ? [{ id: "tracking", label: "للمتابعة فقط" }] : []),
    { id: "closed", label: "تم الحل" },
    { id: "all", label: browseAll ? "جميع الشكاوى، بما فيها المحلولة" : "السجل الكامل" },
  ];
  return (
    <div className="agent-workspace">
      {!browseAll && (
        <>
          <DashHello name={data.me.name} line={helloLine} />
          <KpiCards
            selected={queue}
            onPick={(key) => setQueue(queue === key ? "open" : key)}
            items={[
              {
                key: "working",
                label: "بانتظار البدء أو جارٍ العمل",
                value: count("working"),
                icon: Headphones,
                tone: "burgundy",
              },
              {
                key: "contact",
                label: "تحتاج تواصلاً مع العميل",
                value: count("contact"),
                icon: MessageSquare,
                tone: "blue",
              },
              {
                key: "late",
                label: "متأخرة عن المهلة",
                value: lateCount,
                icon: AlertTriangle,
                tone: "red",
              },
              {
                key: "waiting",
                label: "سجلتها وبانتظار الإسناد",
                value: count("waiting"),
                icon: Clock,
                tone: "amber",
              },
            ]}
          />
          <AttentionStrip tickets={scoped} onOpen={onOpen} />
        </>
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
          <div className="dash-case-list">
            {tickets.map((t) => {
              const stage = agentQueue(t, data.me.id);
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
                <CaseRow
                  key={t.id}
                  t={t}
                  onOpen={onOpen}
                  action={next}
                  status={
                    browseAll
                      ? states[t.state]!
                      : stage === "escalated"
                        ? "قيد التصعيد"
                        : stage === "waiting"
                          ? "بانتظار الإسناد"
                          : stage === "tracking"
                            ? "للمتابعة فقط"
                            : states[t.state]!
                  }
                />
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
