import { n } from "./types";
export function reportDuration(hours: number | null) {
  if (hours === null) return "—";
  const minutes = Math.max(0, Math.round(hours * 60));
  if (minutes < 60) return `${n(minutes)} د`;
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  if (h < 24) return `${n(h)} س${m ? ` ${n(m)} د` : ""}`;
  const days = Math.floor(h / 24),
    remaining = h % 24;
  return `${n(days)} يوم${remaining ? ` ${n(remaining)} س` : ""}`;
}
