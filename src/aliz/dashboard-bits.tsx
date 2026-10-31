import type { ComponentType } from "react";
import { AlertTriangle, ArrowLeft, Clock } from "lucide-react";
import { ago, deadlineLabel, greeting, nextDeadline } from "@/lib/dashboard";
import { categories, n, type Ticket } from "./types";

/*
 * Shared pieces of the staff overview: the greeting header, the number cards,
 * the "needs attention now" strip and a complaint row with its deadline.
 */

export function DashHello({ name, line }: { name: string; line: string }) {
  return (
    <section className="dash-hello">
      <h2>
        {greeting()}، {name.split(" ")[0]}
      </h2>
      <p>{line}</p>
    </section>
  );
}

export type Kpi = {
  key: string;
  label: string;
  value: number;
  icon: ComponentType<{ size?: number }>;
  tone: "burgundy" | "amber" | "red" | "green" | "blue";
  hint?: string;
};

export function KpiCards({
  items,
  selected,
  onPick,
}: {
  items: Kpi[];
  selected?: string;
  onPick: (key: string) => void;
}) {
  return (
    <section className="dash-kpis" aria-label="ملخص الأرقام">
      {items.map((k) => (
        <button
          key={k.key}
          type="button"
          className={"dash-kpi " + k.tone + (selected === k.key ? " selected" : "")}
          aria-pressed={selected === k.key}
          onClick={() => onPick(k.key)}
        >
          <span className="dash-kpi-icon" aria-hidden="true">
            <k.icon size={20} />
          </span>
          <b>{n(k.value)}</b>
          <span className="dash-kpi-label">{k.label}</span>
          {k.hint && <small>{k.hint}</small>}
        </button>
      ))}
    </section>
  );
}

export function DeadlineChip({ t }: { t: Ticket }) {
  if (t.state === "CLOSED" || t.state === "RESOLVED") return null;
  const d = nextDeadline(t.timers);
  if (!d) return null;
  const soon = !d.late && d.minutes <= 15;
  return (
    <span className={"dash-deadline" + (d.late ? " late" : soon ? " soon" : "")}>
      <Clock size={12} />
      {deadlineLabel(d)}
    </span>
  );
}

/** Up to three open complaints that are urgent (P1) or past a deadline. */
export function AttentionStrip({
  tickets,
  onOpen,
}: {
  tickets: Ticket[];
  onOpen: (id: string) => void;
}) {
  const urgent = tickets
    .filter((t) => t.state !== "CLOSED" && (t.priority === "P1" || nextDeadline(t.timers)?.late))
    .sort(
      (a, b) =>
        (nextDeadline(a.timers)?.minutes ?? Infinity) -
        (nextDeadline(b.timers)?.minutes ?? Infinity),
    );
  if (!urgent.length) return null;
  return (
    <section className="dash-attention" aria-label="تحتاج انتباهك الآن">
      <div className="dash-attention-head">
        <AlertTriangle size={18} />
        <b>تحتاج انتباهك الآن</b>
        <span>{n(urgent.length)}</span>
      </div>
      <div className="dash-attention-list">
        {urgent.slice(0, 3).map((t) => (
          <button key={t.id} type="button" onClick={() => onOpen(t.id)}>
            <span>
              <b dir="ltr">{t.number}</b> · {categories[t.category]}
            </span>
            <small>
              {t.brand.name} — {t.branch?.name ?? "فرع غير محدد"}
            </small>
            <DeadlineChip t={t} />
            <ArrowLeft size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}

export function CaseRow({
  t,
  status,
  action,
  onOpen,
}: {
  t: Ticket;
  status: string;
  action: string;
  onOpen: (id: string) => void;
}) {
  return (
    <article className={"dash-case" + (t.priority === "P1" ? " urgent" : "")}>
      <img src={"/logos/" + t.brand.logo} alt="" />
      <div className="dash-case-main">
        <div className="dash-case-top">
          <b dir="ltr">{t.number}</b>
          {t.priority === "P1" && <span className="badge red">حرجة</span>}
          <span className="badge neutral">{status}</span>
          <DeadlineChip t={t} />
        </div>
        <h3>{categories[t.category]}</h3>
        <p>
          {t.brand.name} — {t.branch?.name ?? "فرع غير محدد"} · {ago(t.receivedAt)}
          {t.externalOrder ? " · الطلب " + t.externalOrder : ""}
        </p>
      </div>
      <button type="button" className="secondary" onClick={() => onOpen(t.id)}>
        {action}
        <ArrowLeft size={16} />
      </button>
    </article>
  );
}
