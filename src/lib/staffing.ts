import { assignmentFor, type RotationPlan, type ShiftPattern } from "./rotation";

/*
 * Schedule generator: turns the team size, hours per person per day, opening
 * hours and the peak window into shift patterns and a rotation.
 *
 * Every opening hour is covered first; the remaining people are placed where
 * they help most, with peak hours counting three times as much, so the peak
 * gets the most people. Breaks (30 minutes for shifts of 6 hours or more) are
 * placed near the middle of the shift but never inside the peak. Everyone gets
 * one day off a week, spread across the team.
 */

export type StaffingInput = {
  employees: number;
  hours: number; // per person per day, including the break
  open: string; // "HH:MM"
  close: string; // "HH:MM"; at or before open means after midnight
  peakStart: string;
  peakEnd: string;
};

const STEP = 30;
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
export const toTime = (m: number) => {
  const x = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};

/** Opening day in minutes from midnight; times after midnight run past 1440. */
export function window(input: Pick<StaffingInput, "open" | "close" | "peakStart" | "peakEnd">) {
  const open = toMin(input.open);
  let close = toMin(input.close);
  if (close <= open) close += 1440;
  let ps = toMin(input.peakStart),
    pe = toMin(input.peakEnd);
  if (pe <= ps) pe += 1440;
  if (ps < open && ps + 1440 < close) {
    ps += 1440;
    pe += 1440;
  }
  return { open, close, peakStart: Math.max(ps, open), peakEnd: Math.min(pe, close) };
}

const inPeak = (t: number, w: ReturnType<typeof window>) => t >= w.peakStart && t < w.peakEnd;

function placeBreak(start: number, end: number, w: ReturnType<typeof window>) {
  if (end - start < 360) return null;
  const mid = start + Math.round((end - start) / 2 / STEP) * STEP - STEP;
  const options: number[] = [];
  for (let t = start + 60; t + 30 <= end - 60; t += STEP)
    if (!inPeak(t, w) && !inPeak(t + 29, w)) options.push(t);
  const at = options.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0] ?? mid;
  return { breakStart: toTime(at), breakEnd: toTime(at + 30) };
}

const names = (count: number, i: number, peak: boolean) =>
  count === 1
    ? "وردية يومية"
    : i === 0
      ? "افتتاح"
      : i === count - 1
        ? "إغلاق"
        : peak
          ? "ذروة"
          : "منتصف";

/** Shift patterns and one slot per employee (which pattern they start on). */
export function designShifts(input: StaffingInput) {
  const w = window(input);
  const span = w.close - w.open;
  const length = Math.min(Math.round((input.hours * 60) / STEP) * STEP, span);
  const slotsCount = span / STEP;
  const weight = (i: number) => (inPeak(w.open + i * STEP, w) ? 3 : 1);
  const cover = new Array<number>(slotsCount).fill(0);
  const starts: number[] = [];
  const candidates: number[] = [];
  for (let t = w.open; t + length <= w.close; t += STEP) candidates.push(t);
  if (!candidates.includes(w.close - length)) candidates.push(w.close - length);
  const add = (t: number) => {
    starts.push(t);
    for (let i = (t - w.open) / STEP; i < (t - w.open + length) / STEP; i++) cover[i]!++;
  };
  // Opening and closing first, so the whole day is covered when there are enough people.
  const forced = [w.open, w.close - length].filter((t, i, a) => a.indexOf(t) === i);
  for (const t of forced) if (starts.length < input.employees) add(t);
  while (starts.length < input.employees) {
    let best = candidates[0]!,
      gain = -1;
    for (const t of candidates) {
      let g = 0;
      for (let i = (t - w.open) / STEP; i < (t - w.open + length) / STEP; i++)
        g += weight(i) / (1 + cover[i]!) ** 2;
      if (g > gain + 1e-9) {
        gain = g;
        best = t;
      }
    }
    add(best);
  }
  const unique = [...new Set(starts)].sort((a, b) => a - b);
  const peakMid = (w.peakStart + w.peakEnd) / 2;
  const labels = unique.map((t, i) =>
    names(unique.length, i, t <= peakMid && t + length >= peakMid),
  );
  const shifts: ShiftPattern[] = unique.map((t, i) => ({
    id: "g" + toTime(t).replace(":", ""),
    name:
      labels.filter((l) => l === labels[i]).length > 1
        ? `${labels[i]} ${labels.slice(0, i + 1).filter((l) => l === labels[i]).length}`
        : labels[i]!,
    start: toTime(t),
    end: toTime(t + length),
    ...placeBreak(t, t + length, w),
  }));
  // Interleave the patterns so people on the same pattern get different days off.
  const pool = unique.map((t) => ({
    id: "g" + toTime(t).replace(":", ""),
    left: starts.filter((s) => s === t).length,
  }));
  const slots: string[] = [];
  while (slots.length < starts.length)
    for (const p of pool)
      if (p.left > 0) {
        slots.push(p.id);
        p.left--;
      }
  return { shifts, slots, length };
}

/** People on duty in each 30-minute slot, lowest and average across the week. */
export function hourlyCoverage(
  plan: Pick<RotationPlan, "shifts" | "members" | "slots" | "daysOff">,
  input: StaffingInput,
) {
  const w = window(input);
  const full: RotationPlan = {
    enabled: false,
    leads: [],
    anchor: "2026-01-04",
    weeksAhead: 1,
    ...plan,
  };
  const rows: { time: string; min: number; avg: number; peak: boolean }[] = [];
  for (let t = w.open; t < w.close; t += STEP) {
    const perDay = Array.from(
      { length: 7 },
      (_, d) =>
        full.members.filter((_, i) => {
          const a = assignmentFor(full, i, 0);
          if (a.offDays.includes(d)) return false;
          let s = toMin(a.shift.start),
            e = toMin(a.shift.end);
          if (s < w.open) s += 1440;
          if (e <= s) e += 1440;
          // Breaks are short and can be staggered, so they do not count as gaps.
          return t >= s && t < e;
        }).length,
    );
    rows.push({
      time: toTime(t),
      min: Math.min(...perDay),
      avg: perDay.reduce((x, y) => x + y, 0) / 7,
      peak: inPeak(t, w),
    });
  }
  return rows;
}

/** Plan for a team of a given size, and how well it covers the day. */
export function generate(input: StaffingInput, members: string[]) {
  const design = designShifts(input);
  const ids =
    members.length === input.employees
      ? members
      : Array.from({ length: input.employees }, (_, i) => "slot-" + i);
  const plan = { shifts: design.shifts, slots: design.slots, members: ids, daysOff: 1 };
  const rows = hourlyCoverage(plan, input);
  return {
    ...design,
    rows,
    uncovered: rows.filter((r) => r.min === 0).map((r) => r.time),
    thinPeak: rows.filter((r) => r.peak && r.min < 2).map((r) => r.time),
  };
}

/** Smallest team that covers every opening slot every day, with 2+ at peak. */
export function recommendedTeam(input: Omit<StaffingInput, "employees">) {
  for (let n = 1; n <= 60; n++) {
    const g = generate({ ...input, employees: n }, []);
    if (!g.uncovered.length && !g.thinPeak.length) return n;
  }
  return null;
}
