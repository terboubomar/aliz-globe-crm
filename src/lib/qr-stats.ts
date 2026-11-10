/*
 * QR stats: visits to the QR form per day next to the complaints and
 * suggestions sent from it. Pure, so the page and tests share it.
 */
export type ScanRow = { day: string; brandId: string; n: number };
export type SubmissionRow = {
  day: string;
  brandId: string;
  branchId: string | null;
  suggestion: boolean;
  n: number;
};
export type HourRow = { hour: number; n: number };
export type QrStatsData = { scans: ScanRow[]; submissions: SubmissionRow[]; hours: HourRow[] };

const pct = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 10 : null;

/** Every day from `from` to `to` (YYYY-MM-DD), so empty days show as zero. */
export function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let d = Date.parse(from + "T12:00:00Z"); d <= Date.parse(to + "T12:00:00Z"); d += 86400000)
    out.push(new Date(d).toISOString().slice(0, 10));
  return out;
}

export function summarizeQr(data: QrStatsData, from: string, to: string) {
  const scans = data.scans.reduce((s, r) => s + r.n, 0);
  const complaints = data.submissions.filter((r) => !r.suggestion).reduce((s, r) => s + r.n, 0);
  const suggestions = data.submissions.filter((r) => r.suggestion).reduce((s, r) => s + r.n, 0);
  const days = daysBetween(from, to).map((day) => ({
    day,
    scans: data.scans.filter((r) => r.day === day).reduce((s, r) => s + r.n, 0),
    sent: data.submissions.filter((r) => r.day === day).reduce((s, r) => s + r.n, 0),
  }));
  const brandIds = [...new Set([...data.scans, ...data.submissions].map((r) => r.brandId))];
  const brands = brandIds
    .map((brandId) => {
      const s = data.scans.filter((r) => r.brandId === brandId).reduce((a, r) => a + r.n, 0);
      const c = data.submissions
        .filter((r) => r.brandId === brandId && !r.suggestion)
        .reduce((a, r) => a + r.n, 0);
      const g = data.submissions
        .filter((r) => r.brandId === brandId && r.suggestion)
        .reduce((a, r) => a + r.n, 0);
      return { brandId, scans: s, complaints: c, suggestions: g, conversion: pct(c + g, s) };
    })
    .sort((a, b) => b.scans - a.scans || b.complaints - a.complaints);
  const branchKeys = [...new Set(data.submissions.map((r) => `${r.brandId}|${r.branchId ?? ""}`))];
  const branches = branchKeys
    .map((key) => {
      const [brandId, branchId] = key.split("|") as [string, string];
      const rows = data.submissions.filter(
        (r) => r.brandId === brandId && (r.branchId ?? "") === branchId,
      );
      const c = rows.filter((r) => !r.suggestion).reduce((a, r) => a + r.n, 0);
      const g = rows.filter((r) => r.suggestion).reduce((a, r) => a + r.n, 0);
      return { brandId, branchId: branchId || null, complaints: c, suggestions: g, total: c + g };
    })
    .sort((a, b) => b.total - a.total);
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    n: data.hours.find((h) => h.hour === hour)?.n ?? 0,
  }));
  const busiest = hours.reduce((best, h) => (h.n > best.n ? h : best), hours[0]!);
  return {
    scans,
    complaints,
    suggestions,
    sent: complaints + suggestions,
    conversion: pct(complaints + suggestions, scans),
    days,
    brands,
    branches,
    hours,
    busiestHour: busiest.n ? busiest.hour : null,
  };
}
