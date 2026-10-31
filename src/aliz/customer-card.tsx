import { useEffect, useState } from "react";
import { History, Mail, MessageCircle, Phone, ShoppingBag, UserRound } from "lucide-react";
import { normalizePhone } from "@/lib/domain";
import { api, date, n, states, type Ticket } from "./types";

/** "966512345678" → "0512345678" for reading and dialling inside Saudi Arabia. */
const localPhone = (phone: string) => {
  const p = normalizePhone(phone);
  return p.startsWith("966") ? "0" + p.slice(3) : phone;
};

type Past = { id: string; number: string; state: string; receivedAt: string };

/**
 * The customer behind a complaint, at the top of its details: name, phone with
 * call and WhatsApp buttons, email, the order, and the customer's other
 * complaints (found by phone). Shown only to roles allowed to see customer
 * data; others see a short note instead.
 */
export function CustomerCard({ t, canSee }: { t: Ticket; canSee: boolean }) {
  const [past, setPast] = useState<Past[] | null>(null);
  const phone = t.customer?.phone ?? "";
  useEffect(() => {
    if (!canSee || !phone) return;
    let alive = true;
    api<Past[]>("customers/search", { phone })
      .then((list) => alive && setPast(list.filter((x) => x.id !== t.id)))
      .catch(() => alive && setPast(null));
    return () => {
      alive = false;
    };
  }, [canSee, phone, t.id]);

  if (!canSee)
    return (
      <section className="customer-card muted">
        <UserRound size={18} />
        <p>بيانات العميل محجوبة حسب صلاحيات حسابك.</p>
      </section>
    );
  const c = t.customer;
  const wa = phone ? normalizePhone(phone) : "";
  return (
    <section className="customer-card" aria-label="بيانات العميل">
      <div className="customer-card-head">
        <span className="customer-avatar" aria-hidden="true">
          {c?.name?.trim()?.[0] ?? <UserRound size={20} />}
        </span>
        <div>
          <small>العميل</small>
          <b>{c?.name?.trim() || "لم يذكر اسمه"}</b>
        </div>
        {past && past.length > 0 && (
          <span className="customer-repeat">
            <History size={13} /> {n(past.length)} شكاوى سابقة
          </span>
        )}
      </div>

      {!c?.phone && !c?.email ? (
        <p className="customer-none">لم يترك العميل رقماً أو بريداً للتواصل.</p>
      ) : (
        <div className="customer-contacts">
          {c?.phone && (
            <div className="customer-line">
              <Phone size={15} />
              <span dir="ltr">{localPhone(c.phone)}</span>
              <a className="customer-btn call" href={"tel:" + localPhone(c.phone)}>
                <Phone size={14} /> اتصال
              </a>
              <a
                className="customer-btn wa"
                href={"https://wa.me/" + wa}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle size={14} /> واتساب
              </a>
            </div>
          )}
          {c?.email && (
            <div className="customer-line">
              <Mail size={15} />
              <span dir="ltr">{c.email}</span>
              <a className="customer-btn" href={"mailto:" + c.email}>
                <Mail size={14} /> بريد
              </a>
            </div>
          )}
        </div>
      )}

      {(t.externalOrder || t.platform) && (
        <div className="customer-order">
          <ShoppingBag size={15} />
          {t.platform && <span>{t.platform}</span>}
          {t.externalOrder && (
            <span>
              رقم الطلب <b dir="ltr">{t.externalOrder}</b>
            </span>
          )}
        </div>
      )}

      {past && past.length > 0 && (
        <details className="customer-history">
          <summary>الشكاوى السابقة لنفس الرقم</summary>
          <ul>
            {past.slice(0, 10).map((p) => (
              <li key={p.id}>
                <b dir="ltr">{p.number}</b>
                <span>{states[p.state]}</span>
                <small>{date(p.receivedAt)}</small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
