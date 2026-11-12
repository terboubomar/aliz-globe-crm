import { hasFullAccess } from "@/lib/domain";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Link2, RefreshCw, Send, Sparkles, Star, Unlink } from "lucide-react";
import {
  PLACEHOLDERS,
  STARS,
  replyStateLabels,
  type GoogleRules,
  type ReplyMode,
  type SendMode,
  type Stars,
} from "@/lib/google-reviews";
import { api, date, n, type Data, type GoogleReview } from "./types";
import { Empty, Field } from "./ui";

/* ------------------------------ shared bits ------------------------------ */

export function StarRow({ rating, size = 15 }: { rating: number; size?: number }) {
  return (
    <span className="g-stars" role="img" aria-label={`${rating} من 5 نجوم`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= rating ? "on" : ""} aria-hidden="true" />
      ))}
    </span>
  );
}

const sourceNames: Record<string, string> = {
  SCRIPT: "رد جاهز",
  AI: "ذكاء اصطناعي",
  STAFF: "موظف",
  GOOGLE: "من Google مباشرة",
};

/** One review with its reply box: used on the reviews page and inside a complaint. */
export function ReviewCard({
  review,
  branchName,
  canReply,
  aiAvailable,
  onDone,
  onOpenTicket,
}: {
  review: GoogleReview;
  branchName: string;
  canReply: boolean;
  aiAvailable: boolean;
  onDone: () => void | Promise<void>;
  onOpenTicket?: ((id: string) => void) | undefined;
}) {
  const sent = review.replyState === "SENT";
  const [text, setText] = useState(sent ? "" : review.reply),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setText(review.replyState === "SENT" ? "" : review.reply);
    setEditing(false);
  }, [review.id, review.reply, review.replyState]);
  async function send() {
    setBusy(true);
    setError("");
    try {
      await api("reviews/reply", { id: review.id, text });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function suggest() {
    setBusy(true);
    setError("");
    try {
      const out = await api<{ text: string }>("reviews/suggest", { id: review.id });
      setText(out.text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const showBox = canReply && (!sent || editing);
  return (
    <article className={"g-review" + (review.rating <= 2 ? " low" : "")}>
      <header className="g-review-head">
        <div>
          <b>{review.reviewer || "مستخدم Google"}</b>
          <small>
            {branchName} · <time dateTime={review.createdAt}>{date(review.createdAt)}</time>
          </small>
        </div>
        <StarRow rating={review.rating} />
      </header>
      <p className="g-review-text">{review.comment || "تقييم بالنجوم فقط، بدون نص."}</p>
      <div className="g-review-meta">
        <span
          className={
            "badge " +
            (sent
              ? "green"
              : review.replyState === "FAILED"
                ? "red"
                : review.replyState === "DRAFT"
                  ? "amber"
                  : "neutral")
          }
        >
          {replyStateLabels[review.replyState] ?? review.replyState}
        </span>
        {review.ticketNumber && onOpenTicket && review.ticketId && (
          <button className="text-btn" onClick={() => onOpenTicket(review.ticketId!)}>
            الشكوى {review.ticketNumber}
          </button>
        )}
      </div>
      {sent && review.reply && !editing && (
        <div className="g-reply">
          <small>
            ردّنا{review.replySource ? ` · ${sourceNames[review.replySource] ?? ""}` : ""}
            {review.repliedAt ? ` · ${date(review.repliedAt)}` : ""}
          </small>
          <p>{review.reply}</p>
          {canReply && (
            <button
              className="text-btn"
              onClick={() => {
                setText(review.reply);
                setEditing(true);
              }}
            >
              تعديل الرد
            </button>
          )}
        </div>
      )}
      {showBox && (
        <div className="g-reply-box">
          {review.replyState === "DRAFT" && !editing && (
            <small className="g-draft-note">
              مسودة جاهزة ({sourceNames[review.replySource ?? "SCRIPT"]}) — راجعها ثم اضغط «إرسال
              الرد»
            </small>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={1500}
            placeholder="اكتب الرد الذي سيظهر للعموم في Google"
            aria-label="نص الرد على التقييم"
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="g-reply-actions">
            <button
              className="primary"
              disabled={busy || text.trim().length < 2}
              onClick={() => void send()}
            >
              <Send size={15} />{" "}
              {review.replyState === "DRAFT" ? "اعتماد وإرسال الرد" : "إرسال الرد"}
            </button>
            {aiAvailable && (
              <button className="secondary" disabled={busy} onClick={() => void suggest()}>
                <Sparkles size={15} /> اقتراح رد
              </button>
            )}
            {editing && (
              <button className="text-btn" onClick={() => setEditing(false)}>
                إلغاء
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/* ------------------------------ reviews page ------------------------------ */

export function ReviewsWorkspace({
  data,
  brand,
  onOpenTicket,
}: {
  data: Data;
  brand: string;
  onOpenTicket: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"unanswered" | "pending" | "all">("unanswered"),
    [rows, setRows] = useState<GoogleReview[] | null>(null),
    [pending, setPending] = useState(0),
    [error, setError] = useState("");
  const canReply = data.permissions.includes("contact") || hasFullAccess(data.me.role);
  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ filter, ...(brand !== "all" ? { brandId: brand } : {}) });
      const out = await api<{ reviews: GoogleReview[]; pending: number }>(
        "reviews?" + q.toString(),
      );
      setRows(out.reviews);
      setPending(out.pending);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter, brand]);
  useEffect(() => {
    void load();
  }, [load]);
  const branchName = (id: string | null) =>
    data.brands.flatMap((b) => b.branches).find((b) => b.id === id)?.name ?? "فرع غير مربوط";
  return (
    <section className="panel g-reviews">
      <div className="panel-head">
        <h2>
          <Star size={19} />
          تقييمات Google
        </h2>
        <button className="text-btn" onClick={() => void load()}>
          <RefreshCw size={15} />
          تحديث
        </button>
      </div>
      <div className="padded">
        <div className="scope-switch" role="tablist" aria-label="عرض التقييمات">
          {(
            [
              ["unanswered", "تحتاج رداً"],
              ["pending", `بانتظار الموافقة${pending ? ` (${n(pending)})` : ""}`],
              ["all", "الكل"],
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
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {rows && rows.length === 0 && (
          <Empty
            title={filter === "all" ? "لا توجد تقييمات بعد" : "لا توجد تقييمات تحتاج رداً"}
            detail="تصل التقييمات من الفروع المربوطة بحساب Google كل بضع دقائق."
          />
        )}
        <div className="g-review-list">
          {rows?.map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              branchName={branchName(r.branchId)}
              canReply={canReply}
              aiAvailable
              onDone={load}
              onOpenTicket={onOpenTicket}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------- settings: Google --------------------------- */

type Status = {
  missing: string[];
  redirectUri: string;
  connected: boolean;
  connectedAt: string | null;
  lastSync: string | null;
  lastError: string | null;
  linkedBranches: number;
  counts: Record<string, number>;
  aiAvailable: boolean;
  rules: GoogleRules;
};
type Location = {
  location: string;
  title: string;
  address: string;
  account: string;
  branchId: string | null;
};

const modeNames: Record<ReplyMode, string> = {
  off: "بدون رد",
  script: "رد جاهز",
  ai: "ذكاء اصطناعي",
};
const sendNames: Record<SendMode, string> = {
  auto: "يُرسل تلقائياً",
  approve: "بعد موافقة الموظف",
};

export function GoogleIntegration({ data }: { data: Data }) {
  const [status, setStatus] = useState<Status | null>(null),
    [rules, setRules] = useState<GoogleRules | null>(null),
    [locations, setLocations] = useState<Location[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const s = await api<Status>("integrations/google");
      setStatus(s);
      setRules(s.rules);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const result = new URLSearchParams(window.location.search).get("google");
    if (result)
      setNotice(
        result === "connected"
          ? "تم ربط حساب Google. اربط كل فرع بموقعه في Google ثم فعّل الردود."
          : result === "expired"
            ? "انتهت مهلة الربط؛ حاول مرة أخرى."
            : "تعذر ربط حساب Google؛ تأكد من الحساب والصلاحيات وحاول مرة أخرى.",
      );
  }, [load]);
  async function run<T>(fn: () => Promise<T>, done?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const out = await fn();
      if (done) setNotice(done);
      return out;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    const out = await run(() => api<{ url: string }>("integrations/google/connect", {}));
    if (out?.url) window.location.assign(out.url);
  }
  async function loadLocations() {
    const out = await run(() => api<Location[]>("integrations/google/locations", {}));
    if (out) setLocations(out);
  }
  async function link(location: string, branchId: string) {
    const current = locations?.find((l) => l.location === location)?.branchId;
    await run(async () => {
      if (current && current !== branchId)
        await api("integrations/google/link", { branchId: current, location: null });
      if (branchId) await api("integrations/google/link", { branchId, location });
      await loadLocations();
      await load();
    }, "تم حفظ ربط الفرع.");
  }
  function setRule(star: Stars, patch: Partial<GoogleRules["rules"][Stars]>) {
    setRules((r) =>
      r ? { ...r, rules: { ...r.rules, [star]: { ...r.rules[star], ...patch } } } : r,
    );
  }
  const branches = data.brands.flatMap((b) =>
    b.branches.map((br) => ({ ...br, brandName: b.name })),
  );
  const labels: Record<string, string> = {
    GOOGLE_CLIENT_ID: "معرّف تطبيق Google (Client ID)",
    GOOGLE_CLIENT_SECRET: "المفتاح السري لتطبيق Google",
    PUBLIC_APP_ORIGIN: "رابط Portal العام",
  };
  return (
    <section className="panel google-integration">
      <div className="panel-head">
        <h2>
          <Star size={19} />
          Google Business Profile
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
              <span className={"badge " + (status.connected ? "green" : "neutral")}>
                {status.connected ? "مربوط" : "غير مربوط"}
              </span>
              <small>
                التقييمات المنخفضة تتحول إلى شكاوى تلقائياً، ويُرد على كل تقييم حسب عدد النجوم: برد
                جاهز أو بمسودة من الذكاء الاصطناعي، تُرسل تلقائياً أو بعد موافقة الموظف.
              </small>
            </div>

            {status.missing.length > 0 && (
              <div className="g-setup">
                <b>قبل الربط: أضف هذه القيم في أسرار المشروع (Secrets)</b>
                <ul>
                  {status.missing.map((m) => (
                    <li key={m}>
                      <code dir="ltr">{m}</code> — {labels[m] ?? m}
                    </li>
                  ))}
                </ul>
                {status.redirectUri && (
                  <small>
                    عنوان العودة المطلوب في Google Cloud:{" "}
                    <code dir="ltr">{status.redirectUri}</code>
                  </small>
                )}
              </div>
            )}

            <div className="telegram-actions">
              {status.connected ? (
                <>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void loadLocations()}
                  >
                    <Link2 size={15} /> ربط الفروع بمواقع Google
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await api<{
                          created?: number;
                          replied?: number;
                          error?: string | null;
                          skipped?: string;
                        }>("integrations/google/sync", {});
                        await load();
                        if (r.error) throw new Error(r.error);
                        return r;
                      }, "تم جلب التقييمات الجديدة.")
                    }
                  >
                    <RefreshCw size={15} /> جلب التقييمات الآن
                  </button>
                  <button
                    className="text-btn danger"
                    disabled={busy}
                    onClick={() =>
                      window.confirm("فصل حساب Google؟ ستتوقف التقييمات والردود التلقائية.") &&
                      void run(async () => {
                        await api("integrations/google/disconnect", {});
                        await load();
                      }, "تم فصل حساب Google.")
                    }
                  >
                    <Unlink size={15} /> فصل الحساب
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  disabled={busy || status.missing.length > 0}
                  onClick={() => void connect()}
                >
                  <ExternalLink size={15} /> ربط حساب Google
                </button>
              )}
            </div>

            {status.connected && (
              <ul className="telegram-health">
                <li className={status.linkedBranches ? "ok" : "warn"}>
                  {status.linkedBranches
                    ? `${n(status.linkedBranches)} فرع مربوط بموقعه في Google`
                    : "لم يُربط أي فرع بعد — اضغط «ربط الفروع بمواقع Google»"}
                </li>
                <li className="ok">
                  آخر جلب: {status.lastSync ? date(status.lastSync) : "لم يتم بعد"} · التقييمات قبل{" "}
                  {status.connectedAt ? date(status.connectedAt) : "الربط"} تُحفظ للسجل فقط
                </li>
                {status.lastError && (
                  <li className="warn">
                    آخر خطأ: <span>{status.lastError}</span>
                  </li>
                )}
              </ul>
            )}

            {locations && (
              <div className="g-locations">
                <h3>مواقع Google</h3>
                {locations.length === 0 && <p className="hint">لا توجد مواقع في هذا الحساب.</p>}
                {locations.map((l) => (
                  <div className="g-location" key={l.location}>
                    <div>
                      <b>{l.title}</b>
                      <small>{l.address || l.account}</small>
                    </div>
                    <select
                      value={l.branchId ?? ""}
                      disabled={busy}
                      onChange={(e) => void link(l.location, e.target.value)}
                      aria-label={"الفرع المرتبط بـ " + l.title}
                    >
                      <option value="">غير مربوط</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.brandName} — {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {rules && (
              <div className="g-rules">
                <h3>قواعد الرد والشكاوى</h3>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={rules.enabled}
                    onChange={(e) => setRules({ ...rules, enabled: e.target.checked })}
                  />
                  تفعيل الردود التلقائية وتحويل التقييمات إلى شكاوى
                </label>
                <Field label="تحويل التقييم إلى شكوى عندما يكون">
                  <select
                    value={rules.complaintMaxStars}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        complaintMaxStars: Number(
                          e.target.value,
                        ) as GoogleRules["complaintMaxStars"],
                      })
                    }
                  >
                    <option value={0}>لا تحوّل أي تقييم</option>
                    <option value={1}>نجمة واحدة</option>
                    <option value={2}>نجمتين أو أقل</option>
                    <option value={3}>3 نجوم أو أقل</option>
                    <option value={4}>4 نجوم أو أقل</option>
                  </select>
                </Field>
                {STARS.map((star) => {
                  const r = rules.rules[star];
                  return (
                    <div className="g-rule" key={star}>
                      <div className="g-rule-head">
                        <StarRow rating={star} />
                        <select
                          value={r.mode}
                          onChange={(e) => setRule(star, { mode: e.target.value as ReplyMode })}
                          aria-label={`طريقة الرد على ${star} نجوم`}
                        >
                          {(Object.keys(modeNames) as ReplyMode[]).map((m) => (
                            <option key={m} value={m} disabled={m === "ai" && !status.aiAvailable}>
                              {modeNames[m]}
                            </option>
                          ))}
                        </select>
                        {r.mode !== "off" && (
                          <select
                            value={r.send}
                            onChange={(e) => setRule(star, { send: e.target.value as SendMode })}
                            aria-label={`إرسال الرد على ${star} نجوم`}
                          >
                            {(Object.keys(sendNames) as SendMode[]).map((m) => (
                              <option key={m} value={m}>
                                {sendNames[m]}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {r.mode !== "off" && (
                        <textarea
                          value={r.text}
                          rows={2}
                          maxLength={1000}
                          onChange={(e) => setRule(star, { text: e.target.value })}
                          aria-label={`نص الرد الجاهز لـ ${star} نجوم`}
                          placeholder={r.mode === "ai" ? "يُستخدم إذا تعذر الذكاء الاصطناعي" : ""}
                        />
                      )}
                    </div>
                  );
                })}
                <small className="hint">
                  يمكن استخدام: {PLACEHOLDERS.join(" ")} (الرقم = الرقم الموحد 920031754). مع «ذكاء
                  اصطناعي» يُكتب رد مناسب لنص التقييم، ويُستخدم النص الجاهز إذا تعذر ذلك.
                </small>
                <div className="telegram-actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api("settings/google", rules);
                        await load();
                      }, "تم حفظ القواعد.")
                    }
                  >
                    حفظ القواعد
                  </button>
                </div>
              </div>
            )}

            <div className="whatsapp-counts">
              {[
                ["بانتظار الموافقة", status.counts["DRAFT"] ?? 0],
                ["تم الرد", status.counts["SENT"] ?? 0],
                ["تعذر الإرسال", status.counts["FAILED"] ?? 0],
              ].map(([label, value]) => (
                <span key={label as string}>
                  <b>{n(Number(value))}</b>
                  {label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** The review inside a complaint that came from Google, kept fresh after a reply. */
export function TicketReview({
  ticketId,
  initial,
  branchName,
  canReply,
}: {
  ticketId: string;
  initial: GoogleReview;
  branchName: string;
  canReply: boolean;
}) {
  const [review, setReview] = useState(initial);
  useEffect(() => setReview(initial), [initial]);
  return (
    <section className="g-ticket-review">
      <h3>تقييم Google</h3>
      <ReviewCard
        review={review}
        branchName={branchName}
        canReply={canReply}
        aiAvailable
        onDone={async () => {
          const t = await api<{ google?: GoogleReview | null }>("tickets/" + ticketId);
          if (t.google) setReview(t.google);
        }}
      />
    </section>
  );
}
