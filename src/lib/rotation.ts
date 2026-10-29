import { addDays, riyadhISO } from "@/aliz/schedule-time";

/*
 * Weekly rotation for the support team.
 *
 * The manager defines the shift patterns (e.g. morning, evening) and the team in
 * a fixed order. Each week every member moves to the next shift pattern, and
 * their days off move one day later, so nobody is stuck on evenings or always
 * off on the same day. Days off are spread across the team so each day keeps
 * as many people as possible. Weeks start on Sunday, Riyadh time.
 */

export type ShiftPattern = {
  id: string;
  name: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM"; at or before start means it ends the next day
  breakStart?: string | null | undefined;
  breakEnd?: string | null | undefined;
};
export type RotationPlan = {
  enabled: boolean;
  shifts: ShiftPattern[];
  members: string[]; // user ids in rotation order
  leads?: string[] | undefined; // members marked as shift lead when working
  daysOff: number; // per week, consecutive
  anchor: string; // a Sunday (YYYY-MM-DD) where week 0 starts
  weeksAhead: number; // how many future weeks to keep generated
  // From the schedule generator: one pattern id per member position, so busy
  // patterns (e.g. peak) get more people. Without it, patterns get equal shares.
  slots?: string[] | undefined;
  generator?:
    | {
        employees: number;
        hours: number;
        open: string;
        close: string;
        peakStart: string;
        peakEnd: string;
      }
    | undefined;
};
export type Entry = {
  userId: string;
  start: string;
  end: string;
  breakStart: string | null;
  breakEnd: string | null;
  lead: boolean;
  dayOff: boolean;
};

const DAY = 86400000;
export const weekIndex = (anchor: string, sunday: string) =>
  Math.round((Date.parse(`${sunday}T12:00:00Z`) - Date.parse(`${anchor}T12:00:00Z`)) / (7 * DAY));
const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Which pattern and which days off a member gets in a given week. */
export function assignmentFor(plan: RotationPlan, memberIndex: number, week: number) {
  const n = plan.members.length;
  const slotId =
    plan.slots && plan.slots.length === n ? plan.slots[mod(memberIndex + week, n)] : undefined;
  const shift =
    plan.shifts.find((p) => p.id === slotId) ??
    plan.shifts[mod(memberIndex + week, plan.shifts.length)]!;
  const firstOff = mod(Math.floor((memberIndex * 7) / Math.max(n, 1)) + week, 7);
  const offDays = Array.from({ length: plan.daysOff }, (_, k) => mod(firstOff + k, 7));
  return { shift, offDays };
}

function shiftEntry(day: string, s: ShiftPattern) {
  const start = riyadhISO(day, s.start);
  const end = riyadhISO(s.end <= s.start ? addDays(day, 1) : day, s.end);
  let breakStart: string | null = null,
    breakEnd: string | null = null;
  if (s.breakStart && s.breakEnd) {
    breakStart = riyadhISO(s.breakStart < s.start ? addDays(day, 1) : day, s.breakStart);
    breakEnd = riyadhISO(s.breakEnd < s.start ? addDays(day, 1) : day, s.breakEnd);
    if (Date.parse(breakEnd) <= Date.parse(breakStart)) breakStart = breakEnd = null;
  }
  return { start, end, breakStart, breakEnd };
}

/**
 * Entries for one week. `busy` returns true when a member already has something
 * on that day (a manual shift or approved leave); those days are left untouched.
 */
export function weekEntries(
  plan: RotationPlan,
  sunday: string,
  busy: (userId: string, from: string, to: string) => boolean = () => false,
) {
  const week = weekIndex(plan.anchor, sunday);
  const entries: Entry[] = [];
  const skipped: { userId: string; day: string }[] = [];
  plan.members.forEach((userId, i) => {
    const { shift, offDays } = assignmentFor(plan, i, week);
    // A night shift on the last day of the previous week can end after midnight;
    // a day off right after a night shift starts when that shift ends.
    const before = assignmentFor(plan, i, week - 1);
    let lastEnd = before.offDays.includes(6)
      ? 0
      : Date.parse(shiftEntry(addDays(sunday, -1), before.shift).end);
    for (let d = 0; d < 7; d++) {
      const day = addDays(sunday, d);
      const off = offDays.includes(d);
      const times = off
        ? {
            start: new Date(Math.max(Date.parse(riyadhISO(day)), lastEnd)).toISOString(),
            end: riyadhISO(addDays(day, 1)),
            breakStart: null,
            breakEnd: null,
          }
        : shiftEntry(day, shift);
      lastEnd = off ? 0 : Date.parse(times.end);
      if (busy(userId, times.start, times.end)) {
        skipped.push({ userId, day });
        continue;
      }
      entries.push({ userId, ...times, lead: !off && !!plan.leads?.includes(userId), dayOff: off });
    }
  });
  return { entries, skipped, week };
}

/** People working each pattern on each day of the week, to spot gaps before saving. */
export function coverage(plan: RotationPlan, sunday: string) {
  const week = weekIndex(plan.anchor, sunday);
  return Array.from({ length: 7 }, (_, d) =>
    plan.shifts.map((s) => ({
      day: addDays(sunday, d),
      shiftId: s.id,
      count: plan.members.filter((_, i) => {
        const a = assignmentFor(plan, i, week);
        return a.shift.id === s.id && !a.offDays.includes(d);
      }).length,
    })),
  ).flat();
}

export const defaultPlan = (anchor: string): RotationPlan => ({
  enabled: false,
  shifts: [
    {
      id: "morning",
      name: "صباحي",
      start: "10:00",
      end: "18:00",
      breakStart: "14:00",
      breakEnd: "14:30",
    },
    {
      id: "evening",
      name: "مسائي",
      start: "18:00",
      end: "02:00",
      breakStart: "22:00",
      breakEnd: "22:30",
    },
  ],
  members: [],
  leads: [],
  daysOff: 1,
  anchor,
  weeksAhead: 2,
});
