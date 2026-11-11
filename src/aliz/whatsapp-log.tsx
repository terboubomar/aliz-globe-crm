import { useEffect, useState } from "react";
import { MessageCircle, RotateCcw } from "lucide-react";
import { whatsappLog, whatsappResend } from "@/functions/whatsapp.functions";
import { errorText, when } from "./whatsapp-integration";

/* The WhatsApp messages sent to the customer for one complaint, with a resend for admins. */
type Log = Awaited<ReturnType<typeof whatsappLog>>;
const names: Record<string, string> = {
  received: "تأكيد الاستلام",
  resolved: "تمت المعالجة",
  closed: "إغلاق الشكوى",
};
const tones: Record<string, [string, string]> = {
  sent: ["أُرسلت", "green"],
  failed: ["فشلت", "red"],
  skipped: ["لم تُرسل", "neutral"],
};

export function WhatsAppLog({ ticketId }: { ticketId: string }) {
  const [log, setLog] = useState<Log | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const load = () =>
    whatsappLog({ data: { id: ticketId } })
      .then(setLog)
      .catch(() => setLog(null));
  useEffect(() => {
    void load();
  }, [ticketId]);
  if (!log?.rows.length) return null;

  async function resend(template: "received" | "resolved" | "closed") {
    if (!confirm(`إعادة إرسال رسالة «${names[template]}» للعميل على واتساب؟`)) return;
    setBusy(template);
    setError("");
    try {
      const r = await whatsappResend({ data: { id: ticketId, template } });
      if (r.status !== "sent") setError(r.error ?? "لم تُرسل الرسالة");
    } catch (e) {
      setError(errorText(e));
    }
    setBusy("");
    void load();
  }
  const resendable = [...new Set(log.rows.map((r) => r.template))];

  return (
    <section className="wa-log" aria-label="رسائل واتساب للعميل">
      <h3>
        <MessageCircle size={16} /> واتساب
      </h3>
      <ul>
        {log.rows.map((r) => (
          <li key={r.id}>
            <span className={"badge " + (tones[r.status]?.[1] ?? "neutral")}>
              {tones[r.status]?.[0] ?? r.status}
            </span>
            <b>{names[r.template] ?? r.template}</b>
            {r.manual && <small>إعادة إرسال</small>}
            {r.phone_masked && <bdi dir="ltr">{r.phone_masked}</bdi>}
            <time>{when(r.created_at)}</time>
            {r.error && <small className="bevatel-error">{r.error}</small>}
            {r.response && (
              <details>
                <summary>رد Bevatel</summary>
                <pre dir="ltr">{r.response}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      {log.canResend && (
        <div className="wa-log-actions">
          {resendable.map((t) => (
            <button key={t} className="text-btn" disabled={!!busy} onClick={() => void resend(t)}>
              <RotateCcw size={14} /> {busy === t ? "جارٍ الإرسال…" : `إعادة إرسال «${names[t]}»`}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
