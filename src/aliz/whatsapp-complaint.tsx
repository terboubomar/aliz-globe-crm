import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardPlus, RefreshCw, Sparkles } from "lucide-react";
import { asksDetail } from "@/lib/catalog";
import { inboxApi, type ComplaintState, type InboxMessage, type Suggestion } from "./inbox-api";
import { activeCategories, activePlatforms } from "./catalog-state";
import { Field, Modal, Submit } from "./ui";
import type { Data } from "./types";

/*
 * A WhatsApp chat as a complaint. When the chat opens, AI reads it; if the
 * customer is complaining, a card offers to register it with the brand,
 * branch and reason filled in. The agent checks the form and registers it.
 * Once registered, the card links to the complaint.
 */
export function ChatComplaint({
  id,
  data,
  messages,
  lastCustomerId,
  onOpenTicket,
}: {
  id: string;
  data: Data;
  messages: InboxMessage[];
  /** Changes when the customer writes again, so the suggestion is refreshed. */
  lastCustomerId: string | null;
  onOpenTicket: (ticketId: string) => void;
}) {
  const [state, setState] = useState<ComplaintState | null>(null),
    [loading, setLoading] = useState(false),
    [form, setForm] = useState(false);
  const canCreate = data.permissions.includes("create");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await inboxApi.complaint(id));
    } catch {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    if (lastCustomerId) load();
  }, [load, lastCustomerId]);

  if (state?.ticket)
    return (
      <div className="wa-complaint done" role="status">
        <CheckCircle2 size={16} aria-hidden="true" />
        <span>
          سُجلت كشكوى رقم <b dir="ltr">{state.ticket.number}</b>
        </span>
        <button type="button" className="text-btn" onClick={() => onOpenTicket(state.ticket!.id)}>
          فتح الشكوى
        </button>
      </div>
    );
  if (!canCreate) return null;
  const s = state?.suggestion;
  return (
    <>
      {s?.isComplaint ? (
        <div className="wa-complaint suggest" role="note">
          <AlertTriangle size={16} aria-hidden="true" />
          <span className="wa-complaint-text">
            <b>يبدو أن العميل يشتكي</b>
            {s.summary && <small>{s.summary}</small>}
          </span>
          <button type="button" className="primary" onClick={() => setForm(true)}>
            <ClipboardPlus size={15} /> مراجعة وتسجيل
          </button>
        </div>
      ) : (
        <div className="wa-complaint quiet">
          {loading ? (
            <span>
              <RefreshCw size={14} className="spin" /> جارٍ قراءة المحادثة…
            </span>
          ) : (
            <span>
              {state?.ai && <Sparkles size={14} aria-hidden="true" />}
              {state?.ai && s ? "لا تبدو شكوى" : "هل هي شكوى؟"}
            </span>
          )}
          <button type="button" className="text-btn" onClick={() => setForm(true)}>
            <ClipboardPlus size={15} /> تسجيل كشكوى
          </button>
        </div>
      )}
      {form && (
        <RegisterDialog
          id={id}
          data={data}
          suggestion={s ?? null}
          messages={messages}
          onClose={() => setForm(false)}
          onDone={(ticket) => {
            setForm(false);
            setState({ ticket, suggestion: null, ai: state?.ai ?? false });
          }}
        />
      )}
    </>
  );
}

function RegisterDialog({
  id,
  data,
  suggestion: s,
  messages,
  onClose,
  onDone,
}: {
  id: string;
  data: Data;
  suggestion: Suggestion | null;
  messages: InboxMessage[];
  onClose: () => void;
  onDone: (ticket: { id: string; number: string }) => void;
}) {
  const categories = activeCategories().filter((c) => c.id !== "SUGGESTION");
  const customerText = messages
    .filter((m) => m.kind === "customer" && m.text.trim())
    .map((m) => m.text.trim())
    .join("\n");
  const [brandId, setBrandId] = useState(s?.brandId ?? data.brands[0]?.id ?? ""),
    [branchId, setBranchId] = useState(s?.branchId ?? ""),
    [unknownReason, setUnknownReason] = useState(""),
    [category, setCategory] = useState(s?.category ?? ""),
    [otherDetail, setOtherDetail] = useState(""),
    [priority, setPriority] = useState<"P1" | "P2" | "P3">(s?.priority ?? "P3"),
    [externalOrder, setExternalOrder] = useState(s?.externalOrder ?? ""),
    [platform, setPlatform] = useState(s?.platform ?? ""),
    [description, setDescription] = useState(
      [s?.summary, customerText && "رسائل العميل على واتساب:\n" + customerText]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 4000),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const brand = data.brands.find((b) => b.id === brandId);
  const reason = categories.find((c) => c.id === category);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const t = await inboxApi.registerComplaint({
        id,
        brandId,
        branchId: branchId || null,
        ...(branchId ? {} : { unknownReason }),
        category,
        ...(reason && asksDetail(reason) ? { otherDetail } : {}),
        priority,
        description,
        ...(externalOrder.trim() ? { externalOrder: externalOrder.trim() } : {}),
        ...(platform ? { platform } : {}),
      });
      if (t.id) onDone({ id: t.id, number: t.number });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="تسجيل المحادثة كشكوى" onClose={onClose} wide>
      {s?.isComplaint && (
        <p className="wa-ai-note">
          <Sparkles size={14} aria-hidden="true" /> عبّأ الذكاء الاصطناعي الحقول من المحادثة؛ راجعها
          قبل التسجيل.
        </p>
      )}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="العلامة التجارية">
            <select
              value={brandId}
              onChange={(e) => {
                setBrandId(e.target.value);
                setBranchId("");
              }}
              required
            >
              {data.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الفرع">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">الفرع غير معروف</option>
              {(brand?.branches ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          {!branchId && (
            <Field label="لماذا الفرع غير معروف؟" full>
              <input
                value={unknownReason}
                onChange={(e) => setUnknownReason(e.target.value)}
                placeholder="مثال: العميل لم يذكر الفرع"
                maxLength={300}
                required
              />
            </Field>
          )}
          <Field label="سبب الشكوى">
            <select value={category} onChange={(e) => setCategory(e.target.value)} required>
              <option value="" disabled>
                اختر السبب
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الأولوية">
            <select
              value={reason?.urgent ? "P1" : priority}
              disabled={!!reason?.urgent}
              onChange={(e) => setPriority(e.target.value as "P1" | "P2" | "P3")}
            >
              <option value="P1">حرجة</option>
              <option value="P2">مرتفعة</option>
              <option value="P3">عادية</option>
            </select>
          </Field>
          {reason && asksDetail(reason) && (
            <Field label="نوع المشكلة" full>
              <input
                value={otherDetail}
                onChange={(e) => setOtherDetail(e.target.value)}
                maxLength={120}
                required
              />
            </Field>
          )}
          <Field label="رقم الطلب (إن وجد)">
            <input
              value={externalOrder}
              onChange={(e) => setExternalOrder(e.target.value)}
              maxLength={100}
              dir="ltr"
            />
          </Field>
          <Field label="منصة الطلب (إن وجدت)">
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">غير محددة</option>
              {activePlatforms().map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="تفاصيل الشكوى" full>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              maxLength={4000}
            />
          </Field>
        </div>
        <p className="wa-ai-note muted">
          اسم العميل ورقمه من محادثة واتساب. يصل العميل رقم الشكوى ورابط المتابعة على واتساب.
        </p>
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
