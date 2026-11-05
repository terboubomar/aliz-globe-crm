import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCheck,
  ExternalLink,
  Facebook,
  Hand,
  Instagram,
  MessageCircle,
  RefreshCw,
  Send,
  TicketPlus,
  Unlink,
} from "lucide-react";
import { asksDetail } from "@/lib/catalog";
import { attachmentLabel, platformNames, type Platform } from "@/lib/meta-inbox";
import { activeCategories, api, date, n, type Data } from "./types";
import { Empty, Field, Modal, Submit } from "./ui";

/* --------------------------------- types --------------------------------- */
type Thread = {
  id: string;
  platform: Platform;
  pageName: string;
  brandId: string | null;
  customer: string;
  lastText: string;
  lastMessageAt: string;
  lastCustomerAt: string | null;
  windowOpen: boolean;
  unread: number;
  status: string;
  takenBy: string | null;
  ticketId: string | null;
  ticketNumber: string | null;
};
type Message = {
  id: string;
  direction: "IN" | "OUT";
  text: string;
  attachments: { type: string; url: string }[];
  sentBy: string | null;
  at: string;
};

const PlatformIcon = ({ p, size = 15 }: { p: Platform; size?: number }) =>
  p === "IG" ? <Instagram size={size} /> : <Facebook size={size} />;

const time = (s: string) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    hour: "numeric",
    minute: "2-digit",
    calendar: "gregory",
  }).format(new Date(s));

/* ------------------------------ inbox page ------------------------------ */
export function InboxWorkspace({
  data,
  brand,
  onOpenTicket,
  onCountChange,
}: {
  data: Data;
  brand: string;
  onOpenTicket: (id: string) => void;
  onCountChange?: (() => void) | undefined;
}) {
  const [filter, setFilter] = useState<"open" | "unread" | "mine" | "closed">("open"),
    [threads, setThreads] = useState<Thread[] | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ filter, ...(brand !== "all" ? { brandId: brand } : {}) });
      setThreads(await api<Thread[]>("inbox?" + q.toString()));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter, brand]);
  useEffect(() => {
    void load();
    // No live connection: refresh the list every 15 seconds while the page is open.
    const t = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(t);
  }, [load]);
  const brandName = (id: string | null) => data.brands.find((b) => b.id === id)?.name ?? "";
  const userName = (id: string | null) => data.users.find((u) => u.id === id)?.name ?? "";
  return (
    <section className={"panel inbox" + (selected ? " has-chat" : "")}>
      <div className="inbox-list">
        <div className="inbox-list-head">
          <div className="scope-switch" role="tablist" aria-label="عرض المحادثات">
            {(
              [
                ["open", "المفتوحة"],
                ["unread", "غير مقروءة"],
                ["mine", "محادثاتي"],
                ["closed", "المغلقة"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={filter === id}
                className={filter === id ? "on" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={() => void load()} aria-label="تحديث">
            <RefreshCw size={16} />
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {threads && threads.length === 0 && (
          <Empty
            title="لا توجد محادثات هنا"
            detail="تصل رسائل إنستغرام وماسنجر للصفحات المربوطة خلال ثوانٍ."
          />
        )}
        <ul className="inbox-threads">
          {threads?.map((t) => (
            <li key={t.id}>
              <button
                className={(selected === t.id ? "on " : "") + (t.unread ? "unread" : "")}
                onClick={() => setSelected(t.id)}
              >
                <span className={"inbox-avatar " + t.platform}>
                  <PlatformIcon p={t.platform} size={16} />
                </span>
                <span className="inbox-thread-main">
                  <span className="inbox-thread-top">
                    <b>{t.customer || "عميل"}</b>
                    <time dateTime={t.lastMessageAt}>{date(t.lastMessageAt)}</time>
                  </span>
                  <span className="inbox-thread-text">{t.lastText}</span>
                  <span className="inbox-thread-meta">
                    {brandName(t.brandId) || t.pageName}
                    {t.takenBy && <> · {userName(t.takenBy)}</>}
                    {t.ticketNumber && <> · شكوى {t.ticketNumber}</>}
                  </span>
                </span>
                {t.unread > 0 && <span className="inbox-unread">{n(t.unread)}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="inbox-chat">
        {selected ? (
          <Conversation
            key={selected}
            id={selected}
            data={data}
            onBack={() => setSelected(null)}
            onChanged={async () => {
              await load();
              onCountChange?.();
            }}
            onOpenTicket={onOpenTicket}
          />
        ) : (
          <Empty title="اختر محادثة" detail="رسائل إنستغرام وماسنجر لجميع العلامات في مكان واحد." />
        )}
      </div>
    </section>
  );
}

function Conversation({
  id,
  data,
  onBack,
  onChanged,
  onOpenTicket,
}: {
  id: string;
  data: Data;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onOpenTicket: (id: string) => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [converting, setConverting] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      const out = await api<{ thread: Thread; messages: Message[] }>("inbox/thread", { id });
      setThread(out.thread);
      setMessages(out.messages);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load().then(() => void onChanged());
    const t = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(t);
    // onChanged is stable enough; reloading on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages.length]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await run(async () => {
      await api("inbox/reply", { id, text });
      setText("");
    });
  }
  if (!thread)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null;
  const me = data.me.id;
  const taker = data.users.find((u) => u.id === thread.takenBy)?.name;
  const canConvert = data.permissions.includes("create") && !thread.ticketId;
  return (
    <div className="chat">
      <header className="chat-head">
        <button className="icon-btn chat-back" onClick={onBack} aria-label="رجوع للمحادثات">
          <ArrowRight size={18} />
        </button>
        <span className={"inbox-avatar " + thread.platform}>
          <PlatformIcon p={thread.platform} size={16} />
        </span>
        <div className="chat-title">
          <b>{thread.customer || "عميل"}</b>
          <small>
            {platformNames[thread.platform]} · {thread.pageName}
            {taker ? ` · مع ${taker}` : ""}
          </small>
        </div>
        <div className="chat-actions">
          {thread.ticketId ? (
            <button className="text-btn" onClick={() => onOpenTicket(thread.ticketId!)}>
              الشكوى {thread.ticketNumber}
            </button>
          ) : (
            canConvert && (
              <button className="secondary" disabled={busy} onClick={() => setConverting(true)}>
                <TicketPlus size={15} /> تحويل إلى شكوى
              </button>
            )
          )}
          {thread.takenBy !== me ? (
            <button
              className="text-btn"
              disabled={busy}
              onClick={() => void run(() => api("inbox/set", { id, change: "take" }))}
            >
              <Hand size={15} /> استلام
            </button>
          ) : (
            <button
              className="text-btn"
              disabled={busy}
              onClick={() => void run(() => api("inbox/set", { id, change: "release" }))}
            >
              ترك المحادثة
            </button>
          )}
          <button
            className="text-btn"
            disabled={busy}
            onClick={() =>
              void run(() =>
                api("inbox/set", { id, change: thread.status === "OPEN" ? "close" : "reopen" }),
              )
            }
          >
            <CheckCheck size={15} /> {thread.status === "OPEN" ? "إغلاق" : "إعادة فتح"}
          </button>
        </div>
      </header>
      <div className="chat-body" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={"bubble " + (m.direction === "IN" ? "in" : "out")}>
            {m.text && <p>{m.text}</p>}
            {m.attachments.map((a, i) =>
              a.type === "image" && a.url ? (
                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer">
                  <img src={a.url} alt="صورة من العميل" loading="lazy" />
                </a>
              ) : (
                <span key={i} className="bubble-attachment">
                  [{attachmentLabel(a.type)}]
                  {a.url && (
                    <a href={a.url} target="_blank" rel="noopener noreferrer">
                      فتح
                    </a>
                  )}
                </span>
              ),
            )}
            <small>
              {time(m.at)}
              {m.direction === "OUT" && m.sentBy && m.sentBy !== "META_APP"
                ? ` · ${data.users.find((u) => u.id === m.sentBy)?.name ?? ""}`
                : m.direction === "OUT"
                  ? " · من تطبيق Meta"
                  : ""}
            </small>
          </div>
        ))}
        <div ref={end} />
      </div>
      {!thread.windowOpen && (
        <p className="chat-window" role="note">
          مرّ أكثر من 24 ساعة على آخر رسالة من العميل؛ يُرسل الرد كـ«رد موظف» ويُسمح به حتى 7 أيام
          فقط.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form className="chat-compose" onSubmit={(e) => void send(e)}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(e as unknown as FormEvent);
            }
          }}
          rows={2}
          maxLength={1000}
          placeholder="اكتب ردك… (Enter للإرسال، Shift+Enter لسطر جديد)"
          aria-label="نص الرد"
        />
        <button
          className="primary"
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="إرسال"
        >
          <Send size={16} />
        </button>
      </form>
      {converting && (
        <ConvertDialog
          thread={thread}
          data={data}
          onClose={() => setConverting(false)}
          onDone={async (ticketId) => {
            setConverting(false);
            await load();
            await onChanged();
            onOpenTicket(ticketId);
          }}
        />
      )}
    </div>
  );
}

function ConvertDialog({
  thread,
  data,
  onClose,
  onDone,
}: {
  thread: Thread;
  data: Data;
  onClose: () => void;
  onDone: (ticketId: string) => Promise<void>;
}) {
  const brand = data.brands.find((b) => b.id === thread.brandId);
  const reasons = activeCategories();
  const [category, setCategory] = useState(reasons[0]?.id ?? ""),
    [detail, setDetail] = useState(""),
    [branchId, setBranchId] = useState(""),
    [unknownReason, setUnknownReason] = useState(""),
    [priority, setPriority] = useState<"P1" | "P2" | "P3">("P3"),
    [phone, setPhone] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reason = reasons.find((r) => r.id === category);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const out = await api<{ id: string }>("inbox/convert", {
        id: thread.id,
        category,
        ...(reason && asksDetail(reason) ? { otherDetail: detail } : {}),
        branchId: branchId || null,
        ...(branchId ? {} : { unknownReason }),
        priority,
        ...(phone.trim() ? { phone } : {}),
        note,
      });
      await onDone(out.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="تحويل المحادثة إلى شكوى" onClose={onClose}>
      {!brand ? (
        <p className="error" role="alert">
          هذه الصفحة غير مربوطة بعلامة تجارية بعد؛ اطلب من مدير النظام ربطها من الإعدادات.
        </p>
      ) : (
        <form className="form-grid" onSubmit={(e) => void submit(e)}>
          <Field label="سبب الشكوى">
            <select value={category} onChange={(e) => setCategory(e.target.value)} required>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          {reason && asksDetail(reason) && (
            <Field label="نوع المشكلة">
              <input
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                required
                minLength={3}
              />
            </Field>
          )}
          <Field label={`الفرع (${brand.name})`}>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">غير معروف</option>
              {brand.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          {!branchId && (
            <Field label="لماذا الفرع غير معروف؟">
              <input
                value={unknownReason}
                onChange={(e) => setUnknownReason(e.target.value)}
                required
                minLength={3}
                placeholder="مثال: العميل لم يذكر الفرع"
              />
            </Field>
          )}
          <Field label="الأولوية">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as "P1" | "P2" | "P3")}
            >
              <option value="P3">عادية P3</option>
              <option value="P2">عالية P2</option>
              <option value="P1">عاجلة P1</option>
            </select>
          </Field>
          <Field label="جوال العميل (إن ذكره في المحادثة)">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              dir="ltr"
              placeholder="05xxxxxxxx"
            />
          </Field>
          <Field label="ملاحظة للفريق" full>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1500}
            />
          </Field>
          <p className="hint full">تُرفق المحادثة كاملة بوصف الشكوى تلقائياً.</p>
          {error && (
            <p className="error full" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions full">
            <Submit busy={busy}>إنشاء الشكوى</Submit>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* -------------------------- settings: Meta card -------------------------- */
type MetaStatus = {
  missing: string[];
  callbackUrl: string;
  webhookUrl: string;
  pages: {
    pageId: string;
    name: string;
    igId: string | null;
    igUsername: string | null;
    brandId: string | null;
    connected: boolean;
  }[];
  lastMessageAt: string | null;
  threads: number;
};

export function MetaIntegration({ data }: { data: Data }) {
  const [status, setStatus] = useState<MetaStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      setStatus(await api<MetaStatus>("integrations/meta"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const r = new URLSearchParams(window.location.search).get("meta");
    if (r)
      setNotice(
        r === "connected"
          ? "تم ربط صفحات Meta. اختر العلامة التجارية لكل صفحة."
          : r === "nopages"
            ? "لم تُختر أي صفحة؛ أعد الربط واختر صفحات العلامات."
            : r === "expired"
              ? "انتهت مهلة الربط؛ حاول مرة أخرى."
              : "تعذر ربط Meta؛ تأكد من الحساب والصلاحيات وحاول مرة أخرى.",
      );
  }, [load]);
  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (done) setNotice(done);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const labels: Record<string, string> = {
    META_APP_ID: "معرّف تطبيق Meta (App ID)",
    META_APP_SECRET: "المفتاح السري لتطبيق Meta (App Secret)",
    META_VERIFY_TOKEN: "رمز التحقق من Webhook (نص عشوائي طويل تختاره)",
    PUBLIC_APP_ORIGIN: "رابط CRM العام",
  };
  return (
    <section className="panel meta-integration">
      <div className="panel-head">
        <h2>
          <MessageCircle size={19} />
          رسائل إنستغرام وماسنجر
        </h2>
        <button className="text-btn" onClick={() => void load()}>
          <RefreshCw size={15} />
          تحديث
        </button>
      </div>
      <div className="padded">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {status && (
          <>
            <div className="telegram-account-status">
              <span
                className={"badge " + (status.pages.some((p) => p.connected) ? "green" : "neutral")}
              >
                {status.pages.some((p) => p.connected) ? "مربوط" : "غير مربوط"}
              </span>
              <small>
                صندوق مشترك لفريق الشكاوى: تصل رسائل الصفحات المربوطة خلال ثوانٍ، ويرد الموظف من CRM
                مباشرة، ويمكن تحويل أي محادثة إلى شكوى.
              </small>
            </div>
            {(status.missing.length > 0 || status.webhookUrl) && (
              <div className="g-setup">
                {status.missing.length > 0 && (
                  <>
                    <b>قبل الربط: أضف هذه القيم في أسرار المشروع (Secrets)</b>
                    <ul>
                      {status.missing.map((m) => (
                        <li key={m}>
                          <code dir="ltr">{m}</code> — {labels[m] ?? m}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {status.webhookUrl && (
                  <small>
                    في تطبيق Meta: عنوان Webhook <code dir="ltr">{status.webhookUrl}</code> · عنوان
                    العودة لتسجيل الدخول <code dir="ltr">{status.callbackUrl}</code>
                  </small>
                )}
              </div>
            )}
            <div className="telegram-actions">
              <button
                className="primary"
                disabled={busy || status.missing.length > 0}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      const out = await api<{ url: string }>("integrations/meta/connect", {});
                      window.location.assign(out.url);
                    } catch (e) {
                      setError((e as Error).message);
                      setBusy(false);
                    }
                  })()
                }
              >
                <ExternalLink size={15} />{" "}
                {status.pages.length ? "إعادة الربط / إضافة صفحات" : "ربط صفحات Meta"}
              </button>
            </div>
            {status.pages.length > 0 && (
              <div className="g-locations">
                <h3>الصفحات المربوطة</h3>
                {status.pages.map((p) => (
                  <div className="g-location" key={p.pageId}>
                    <div>
                      <b>
                        <Facebook size={14} /> {p.name}
                      </b>
                      <small>
                        {p.igUsername ? (
                          <>
                            <Instagram size={12} /> @{p.igUsername}
                          </>
                        ) : (
                          "بدون حساب إنستغرام مرتبط"
                        )}{" "}
                        · {p.connected ? "يستقبل الرسائل" : "غير متصل"}
                      </small>
                    </div>
                    <div className="meta-page-actions">
                      <select
                        value={p.brandId ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          void run(
                            () =>
                              api("integrations/meta/brand", {
                                pageId: p.pageId,
                                brandId: e.target.value || null,
                              }),
                            "تم حفظ العلامة.",
                          )
                        }
                        aria-label={"العلامة التجارية لصفحة " + p.name}
                      >
                        <option value="">اختر العلامة</option>
                        {data.brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                      {p.connected && (
                        <button
                          className="text-btn danger"
                          disabled={busy}
                          onClick={() =>
                            window.confirm(`فصل صفحة «${p.name}»؟ لن تصل رسائلها إلى CRM.`) &&
                            void run(
                              () => api("integrations/meta/disconnect", { pageId: p.pageId }),
                              "تم فصل الصفحة.",
                            )
                          }
                        >
                          <Unlink size={14} /> فصل
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="whatsapp-counts">
              <span>
                <b>{n(status.threads)}</b>
                محادثة
              </span>
              <span>
                <b>{status.lastMessageAt ? date(status.lastMessageAt) : "—"}</b>
                آخر رسالة
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
