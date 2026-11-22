import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCheck,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
} from "lucide-react";
import {
  inboxApi,
  type InboxConversation,
  type InboxFilter,
  type InboxMessage,
  type Staff,
} from "./inbox-api";
import { Empty } from "./ui";
import { ChatComplaint } from "./whatsapp-complaint";
import { n, type Data } from "./types";

/*
 * The shared WhatsApp inbox: conversations from Bevatel on one side, the open
 * chat on the other (one at a time on phones). Lists refresh every 15 seconds
 * and the open chat every 6 seconds while the page is visible.
 */
const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "open", label: "مفتوحة" },
  { id: "pending", label: "بانتظار" },
  { id: "resolved", label: "محلولة" },
  { id: "all", label: "الكل" },
];
type Owner = "mine" | "unassigned" | "all";
const OWNERS: { id: Owner; label: string }[] = [
  { id: "mine", label: "محادثاتي" },
  { id: "unassigned", label: "غير مسندة" },
  { id: "all", label: "الجميع" },
];
const riyadh = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    timeZone: "Asia/Riyadh",
    calendar: "gregory",
    ...opts,
  }).format(new Date(iso));
const dayKey = (iso: string) => riyadh(iso, { year: "numeric", month: "2-digit", day: "2-digit" });
function when(iso: string | null) {
  if (!iso) return "";
  return dayKey(iso) === dayKey(new Date().toISOString())
    ? riyadh(iso, { hour: "2-digit", minute: "2-digit", hour12: false })
    : riyadh(iso, { day: "numeric", month: "short" });
}
const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
function useEvery(ms: number, run: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => visible() && run(), ms);
    return () => clearInterval(t);
  }, [ms, run, active]);
}

export function WhatsappInbox({
  data,
  onOpenTicket,
}: {
  data: Data;
  onOpenTicket: (ticketId: string) => void;
}) {
  const me = data.me.id,
    canAssign = data.permissions.includes("assign");
  const [filter, setFilter] = useState<InboxFilter>("open"),
    // Agents start with their own chats; leads and managers see everyone's.
    [owner, setOwner] = useState<Owner>(canAssign ? "all" : "mine"),
    [list, setList] = useState<InboxConversation[] | null>(null),
    [people, setPeople] = useState<Staff[]>([]),
    [search, setSearch] = useState(""),
    // A Telegram alert links straight to its chat (?chat=…).
    [openId, setOpenId] = useState<string | null>(() =>
      typeof window === "undefined"
        ? null
        : (new URLSearchParams(window.location.search).get("chat")?.match(/^\d{1,12}$/)?.[0] ??
          null),
    ),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    // Where to continue when there are more chats than one load brings.
    [nextPage, setNextPage] = useState<number | null>(null),
    [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const r = await inboxApi.list(filter);
        // A refresh keeps the older chats already loaded with «عرض المزيد».
        setList((old) => {
          if (!quiet || !old) return r.conversations;
          const fresh = new Set(r.conversations.map((c) => c.id));
          return [
            ...r.conversations,
            ...old.slice(r.conversations.length).filter((c) => !fresh.has(c.id)),
          ];
        });
        if (!quiet) setNextPage(r.nextPage);
        setPeople(r.people);
        setError("");
      } catch (e) {
        if (!quiet) setError((e as Error).message);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [filter],
  );
  useEffect(() => {
    setList(null);
    setNextPage(null);
    load();
  }, [load]);
  const poll = useCallback(() => load(true), [load]);
  async function loadMore() {
    if (!nextPage) return;
    setLoadingMore(true);
    try {
      const r = await inboxApi.list(filter, nextPage);
      setList((old) => {
        const have = new Set((old ?? []).map((c) => c.id));
        return [...(old ?? []), ...r.conversations.filter((c) => !have.has(c.id))];
      });
      setNextPage(r.nextPage);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  useEvery(15_000, poll);

  const shown = useMemo(() => {
    const q = search.trim();
    return (list ?? []).filter(
      (c) =>
        (owner === "all" || (owner === "mine" ? c.owner === me : !c.owner)) &&
        (!q ||
          c.name.includes(q) ||
          c.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "") || "\u0000")),
    );
  }, [list, search, owner, me]);
  const unread = (list ?? []).filter((c) => c.unread > 0 && c.owner === me).length;
  const counts = {
    mine: (list ?? []).filter((c) => c.owner === me).length,
    unassigned: (list ?? []).filter((c) => !c.owner).length,
    all: (list ?? []).length,
  };
  const nameOf = (id: string | null) =>
    id ? (id === me ? "أنا" : (people.find((p) => p.id === id)?.name ?? "موظف")) : null;

  return (
    <div className={"wa-inbox" + (openId ? " chat-open" : "")}>
      <section className="wa-list" aria-label="محادثات واتساب">
        <div className="wa-list-head">
          <div className="wa-tabs" role="tablist" aria-label="حالة المحادثات">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={filter === f.id ? "active" : ""}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                {f.id === filter && f.id === "open" && unread > 0 && <small>{n(unread)}</small>}
              </button>
            ))}
          </div>
          <div className="wa-owners" role="group" aria-label="المسؤول">
            {OWNERS.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={owner === o.id}
                className={owner === o.id ? "active" : ""}
                onClick={() => setOwner(o.id)}
              >
                {o.label}
                {list && <small>{n(counts[o.id])}</small>}
              </button>
            ))}
          </div>
          <label className="wa-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              placeholder="ابحث بالاسم أو الرقم"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}{" "}
            <button type="button" className="text-btn" onClick={() => load()}>
              إعادة المحاولة
            </button>
          </div>
        )}
        <div className="wa-items">
          {!list && !error && (
            <p className="wa-loading" role="status">
              <RefreshCw size={16} className="spin" /> جارٍ تحميل المحادثات…
            </p>
          )}
          {list && !shown.length && (
            <Empty
              title={search ? "لا توجد محادثة بهذا الاسم أو الرقم" : "لا توجد محادثات هنا"}
              {...(search ? {} : { detail: "تظهر هنا محادثات واتساب الواردة عبر Bevatel." })}
            />
          )}
          {shown.map((c) => (
            <button
              key={c.id}
              type="button"
              className={
                "wa-item" + (c.id === openId ? " active" : "") + (c.unread ? " unread" : "")
              }
              aria-current={c.id === openId ? "true" : undefined}
              onClick={() => setOpenId(c.id)}
            >
              <span className="wa-avatar" aria-hidden="true">
                {c.name.trim().slice(0, 1)}
              </span>
              <span className="wa-item-main">
                <span className="wa-item-top">
                  <b dir="auto">{c.name}</b>
                  <time>{when(c.lastAt)}</time>
                </span>
                <span className="wa-item-bottom">
                  <span className="wa-preview">
                    {!c.lastFromCustomer && c.lastText && <CheckCheck size={14} aria-label="منا" />}
                    {c.lastText || "—"}
                  </span>
                  {c.unread > 0 && <small className="wa-unread">{n(c.unread)}</small>}
                  {!c.canReply && (
                    <Lock size={13} className="wa-locked" aria-label="انتهت نافذة الرد" />
                  )}
                </span>
                {owner !== "mine" && (
                  <span className={"wa-owner" + (c.owner ? "" : " none")}>
                    {c.owner ? "مع " + nameOf(c.owner) : "غير مسندة"}
                  </span>
                )}
              </span>
            </button>
          ))}
          {list && nextPage && (
            <button
              type="button"
              className="text-btn wa-more-chats"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore && <RefreshCw size={14} className="spin" />} عرض المزيد من المحادثات
            </button>
          )}
        </div>
        <div className="wa-list-foot">
          <button type="button" className="text-btn" disabled={loading} onClick={() => load()}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> تحديث
          </button>
          <span>يتحدث تلقائياً</span>
        </div>
      </section>
      <section className="wa-chat" aria-label="المحادثة">
        {openId ? (
          <Chat
            key={openId}
            id={openId}
            me={me}
            canAssign={canAssign}
            people={people}
            data={data}
            onOpenTicket={onOpenTicket}
            onBack={() => setOpenId(null)}
            onChanged={poll}
          />
        ) : (
          <div className="wa-chat-empty">
            <MessageCircle size={40} strokeWidth={1.5} aria-hidden="true" />
            <h2>اختر محادثة</h2>
            <p>الردود تُرسل إلى العميل على واتساب عبر Bevatel، وتظهر هناك أيضاً.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function Chat({
  id,
  me,
  canAssign,
  people,
  data,
  onOpenTicket,
  onBack,
  onChanged,
}: {
  id: string;
  me: string;
  canAssign: boolean;
  people: Staff[];
  data: Data;
  onOpenTicket: (ticketId: string) => void;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [conv, setConv] = useState<InboxConversation | null>(null),
    [messages, setMessages] = useState<InboxMessage[]>([]),
    [more, setMore] = useState(false),
    [text, setText] = useState(""),
    [sending, setSending] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null),
    stick = useRef(true),
    scroller = useRef<HTMLDivElement>(null);

  const merge = (older: InboxMessage[], newer: InboxMessage[]) => {
    const map = new Map([...older, ...newer].map((m) => [m.id, m]));
    return [...map.values()].sort(
      (a, b) => (a.at ?? "").localeCompare(b.at ?? "") || Number(a.id) - Number(b.id),
    );
  };
  const refresh = useCallback(
    async (first = false) => {
      try {
        const r = await inboxApi.open(id);
        setConv(r.conversation);
        setMessages((m) => (first ? r.messages : merge(m, r.messages)));
        if (first) setMore(r.more);
        setError("");
      } catch (e) {
        if (first) setError((e as Error).message);
      }
    },
    [id],
  );
  useEffect(() => {
    refresh(true).then(onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);
  const poll = useCallback(() => refresh(), [refresh]);
  useEvery(6_000, poll);
  useEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function older() {
    const first = messages[0];
    if (!first) return;
    setBusy(true);
    try {
      const r = await inboxApi.open(id, first.id);
      stick.current = false;
      setMessages((m) => merge(r.messages, m));
      setMore(r.more);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const sent = await inboxApi.reply(id, body);
      stick.current = true;
      setMessages((m) => merge(m, [sent]));
      setText("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function assign(to: string | null) {
    setBusy(true);
    setError("");
    try {
      const r = await inboxApi.assign(id, to);
      setConv((c) => (c ? { ...c, owner: r.owner } : c));
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    if (!conv) return;
    setBusy(true);
    try {
      await inboxApi.setStatus(id, conv.status === "resolved" ? "open" : "resolved");
      await refresh();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  let lastDay = "";
  return (
    <>
      <header className="wa-chat-head">
        <button
          type="button"
          className="icon-btn wa-back"
          aria-label="رجوع إلى المحادثات"
          onClick={onBack}
        >
          <ArrowRight size={19} />
        </button>
        <span className="wa-avatar" aria-hidden="true">
          {(conv?.name ?? "").trim().slice(0, 1)}
        </span>
        <div className="wa-chat-who">
          <b dir="auto">{conv?.name ?? "…"}</b>
          {conv?.phone && <small dir="ltr">{conv.phone}</small>}
        </div>
        {conv &&
          (canAssign ? (
            <label className="wa-assign">
              <span>المسؤول</span>
              <select
                value={conv.owner ?? ""}
                disabled={busy}
                onChange={(e) => assign(e.target.value || null)}
              >
                <option value="">غير مسندة</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === me ? p.name + " (أنا)" : p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : !conv.owner ? (
            <button type="button" className="secondary" disabled={busy} onClick={() => assign(me)}>
              استلام المحادثة
            </button>
          ) : conv.owner !== me ? (
            <span className="wa-owner-tag">
              مع {people.find((p) => p.id === conv.owner)?.name ?? "موظف"}
            </span>
          ) : null)}
        {conv && (
          <button
            type="button"
            className="secondary wa-status-btn"
            disabled={busy}
            onClick={toggle}
          >
            {conv.status === "resolved" ? (
              <>
                <RotateCcw size={15} /> إعادة فتح
              </>
            ) : (
              <>
                <CheckCircle2 size={15} /> تم الحل
              </>
            )}
          </button>
        )}
      </header>
      <div
        className="wa-messages"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {more && (
          <button type="button" className="text-btn wa-older" disabled={busy} onClick={older}>
            عرض الرسائل الأقدم
          </button>
        )}
        {!conv && !error && (
          <p className="wa-loading" role="status">
            <RefreshCw size={16} className="spin" /> جارٍ تحميل المحادثة…
          </p>
        )}
        {messages.map((m) => {
          const day = m.at ? dayKey(m.at) : "";
          const sep = day && day !== lastDay;
          lastDay = day || lastDay;
          return (
            <div key={m.id} className="wa-row-wrap">
              {sep && m.at && (
                <div className="wa-day">
                  <span>{riyadh(m.at, { weekday: "long", day: "numeric", month: "long" })}</span>
                </div>
              )}
              {m.kind === "event" ? (
                <div className="wa-event">{m.text}</div>
              ) : (
                <div className={"wa-row " + m.kind}>
                  <div className="wa-bubble">
                    {m.kind === "note" && <span className="wa-note-tag">ملاحظة داخلية</span>}
                    {m.kind === "agent" && m.sender && (
                      <span className="wa-sender">{m.sender}</span>
                    )}
                    {m.attachments.map((a) =>
                      a.type === "image" ? (
                        <a
                          key={a.url}
                          href={a.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="wa-image"
                        >
                          <img src={a.thumb ?? a.url} alt="صورة من المحادثة" loading="lazy" />
                        </a>
                      ) : a.type === "audio" ? (
                        <audio key={a.url} controls preload="none" src={a.url} />
                      ) : (
                        <a
                          key={a.url}
                          href={a.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="wa-file"
                        >
                          <FileText size={16} />{" "}
                          {a.name ?? (a.type === "video" ? "فيديو" : "ملف مرفق")}
                        </a>
                      ),
                    )}
                    {m.text && <p dir="auto">{m.text}</p>}
                    <span className="wa-meta">
                      {m.at && (
                        <time>
                          {riyadh(m.at, { hour: "2-digit", minute: "2-digit", hour12: false })}
                        </time>
                      )}
                      {m.kind === "agent" &&
                        (m.status === "failed" ? (
                          <span className="wa-failed">لم تُرسل</span>
                        ) : m.status === "read" ? (
                          <CheckCheck size={14} className="wa-read" aria-label="قُرئت" />
                        ) : m.status === "delivered" ? (
                          <CheckCheck size={14} aria-label="وصلت" />
                        ) : (
                          <Clock size={12} aria-label="أُرسلت" />
                        ))}
                    </span>
                    {m.error && <span className="wa-failed">{m.error}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {conv && (
        <ChatComplaint
          id={id}
          data={data}
          messages={messages}
          lastCustomerId={[...messages].reverse().find((m) => m.kind === "customer")?.id ?? null}
          onOpenTicket={onOpenTicket}
        />
      )}
      {error && (
        <div className="error wa-chat-error" role="alert">
          {error}
        </div>
      )}
      {conv && !conv.canReply ? (
        <div className="wa-closed" role="note">
          <Lock size={16} aria-hidden="true" />
          مرّت أكثر من 24 ساعة على آخر رسالة من العميل، ولا يسمح واتساب بالرد الحر. سيُفتح الرد
          عندما يرسل العميل رسالة جديدة.
        </div>
      ) : (
        <form
          className="wa-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            rows={1}
            value={text}
            placeholder="اكتب ردك… (Ctrl+Enter للإرسال)"
            aria-label="نص الرد"
            maxLength={4000}
            disabled={!conv}
            onChange={(e) => {
              setText(e.target.value);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 160) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            type="submit"
            className="primary wa-send"
            disabled={!text.trim() || sending || !conv}
            aria-label="إرسال"
          >
            {sending ? <RefreshCw size={18} className="spin" /> : <Send size={18} />}
          </button>
        </form>
      )}
    </>
  );
}
