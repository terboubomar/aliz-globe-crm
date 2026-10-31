/*
 * Small helpers for the staff overview: how long ago a complaint came in, how
 * long is left before its next deadline, and a greeting for the time of day
 * (all in Riyadh time).
 */

type Timer = { dueAt: string; completedAt: string | null };

const span = (minutes: number) => {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} د`;
  if (m < 60 * 24) return `${Math.round(m / 60)} س`;
  return `${Math.round(m / 1440)} ي`;
};

/** The nearest open deadline: minutes left (negative when already late). */
export function nextDeadline(timers: Timer[], now = Date.now()) {
  const pending = timers.filter((t) => !t.completedAt).map((t) => +new Date(t.dueAt));
  if (!pending.length) return null;
  const due = Math.min(...pending);
  const minutes = (due - now) / 60000;
  return { minutes, late: minutes < 0 };
}

export function deadlineLabel(d: { minutes: number; late: boolean }) {
  return d.late ? `متأخرة ${span(-d.minutes)}` : `متبقي ${span(d.minutes)}`;
}

export function ago(iso: string, now = Date.now()) {
  const minutes = (now - +new Date(iso)) / 60000;
  if (minutes < 1) return "الآن";
  return `منذ ${span(minutes)}`;
}

export function riyadhHour(now = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Riyadh",
    }).format(now),
  );
}

export const greeting = (now = new Date()) => (riyadhHour(now) < 12 ? "صباح الخير" : "مساء الخير");
