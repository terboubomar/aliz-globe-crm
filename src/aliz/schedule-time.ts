export const riyadhDay = (value: string | Date) =>
  new Date(+new Date(value) + 3 * 3600000).toISOString().slice(0, 10);
export const riyadhISO = (day: string, time = "00:00") =>
  new Date(`${day}T${time}:00+03:00`).toISOString();
export const addDays = (day: string, count: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
export function weekDays(offset = 0, now = new Date()) {
  const today = riyadhDay(now);
  const sunday = addDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay() + offset * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}
export const localInput = (value: string) =>
  new Date(Date.parse(value) + 3 * 3600000).toISOString().slice(0, 16);
export const localISO = (value: string) => new Date(`${value}:00+03:00`).toISOString();
export const intersects = (start: string, end: string, from: string, to: string) =>
  Date.parse(start) < Date.parse(to) && Date.parse(end) > Date.parse(from);
export function netHours(
  shifts: {
    start: string;
    end: string;
    breakStart: string | null;
    breakEnd: string | null;
    dayOff?: boolean;
  }[],
  from: string,
  to: string,
) {
  const clip = (start: string, end: string) =>
    Math.max(
      0,
      Math.min(Date.parse(end), Date.parse(to)) - Math.max(Date.parse(start), Date.parse(from)),
    );
  return (
    shifts
      .filter((s) => !s.dayOff)
      .reduce(
        (sum, s) =>
          sum +
          clip(s.start, s.end) -
          (s.breakStart && s.breakEnd ? clip(s.breakStart, s.breakEnd) : 0),
        0,
      ) / 3600000
  );
}

export function bulkScheduleEntries(
  userIds: string[],
  days: string[],
  options: {
    dayOff: boolean;
    start: string;
    end: string;
    breakStart?: string | undefined;
    breakEnd?: string | undefined;
    lead: boolean;
  },
) {
  return [...new Set(userIds)].flatMap((userId) =>
    [...new Set(days)].map((day) => {
      if (options.dayOff)
        return {
          userId,
          dayOff: true,
          lead: false,
          start: riyadhISO(day),
          end: riyadhISO(addDays(day, 1)),
          breakStart: null,
          breakEnd: null,
        };
      const start = riyadhISO(day, options.start);
      const end = riyadhISO(options.end <= options.start ? addDays(day, 1) : day, options.end);
      const breakStart = options.breakStart
        ? riyadhISO(options.breakStart < options.start ? addDays(day, 1) : day, options.breakStart)
        : null;
      const breakEnd = options.breakEnd
        ? riyadhISO(
            breakStart && Date.parse(riyadhISO(day, options.breakEnd)) <= Date.parse(breakStart)
              ? addDays(day, 1)
              : day,
            options.breakEnd,
          )
        : null;
      return { userId, dayOff: false, lead: options.lead, start, end, breakStart, breakEnd };
    }),
  );
}
