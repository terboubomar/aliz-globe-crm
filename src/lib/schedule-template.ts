import { addDays, riyadhISO } from "@/aliz/schedule-time";
import type { Entry } from "./rotation";

/*
 * Weekly schedule template: one row per employee, one cell per day (Sunday to
 * Saturday). Managers download it as a CSV, fill it in Excel, and upload it.
 *
 * Cell formats:
 *   10:00-18:00                  a shift (ending at or before its start = next day)
 *   10:00-18:00 / 14:00-14:30    a shift with a break
 *   راحة  (or OFF)               day off
 *   (empty)                      nothing scheduled
 */

export type Cell =
  | { off: true }
  | {
      off?: false;
      start: string;
      end: string;
      breakStart?: string | undefined;
      breakEnd?: string | undefined;
    }
  | null;
export type TemplateRow = { userId: string; lead: boolean; days: Cell[] };
export type Template = { rows: TemplateRow[]; rotate: boolean };
export type Person = { id: string; name: string };

export const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const OFF_WORDS = ["راحة", "اجازة", "إجازة", "off", "day off", "x"];

const digits = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
const time = (s: string) => {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]),
    min = Number(m[2] ?? 0);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return `${String(h % 24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
};
const range = (s: string) => {
  const parts = s.split(/\s*[-–—]\s*|\s+(?:إلى|الى|to)\s+/);
  if (parts.length !== 2) return null;
  const a = time(parts[0]!),
    b = time(parts[1]!);
  return a && b && a !== b ? ([a, b] as const) : null;
};

/** Reads one cell. Returns an error message in Arabic when it can't be read. */
export function parseCell(raw: string): { cell: Cell } | { error: string } {
  const text = digits(raw).trim();
  if (!text || text === "-") return { cell: null };
  if (OFF_WORDS.includes(text.toLowerCase())) return { cell: { off: true } };
  const [shiftPart, breakPart] = text
    .split(/\s*(?:\/|استراحة|break)\s*/i)
    .filter((x, i) => i === 0 || x);
  const shift = range(shiftPart ?? "");
  if (!shift) return { error: `«${raw.trim()}» ليس وقتاً صالحاً؛ اكتب مثل 10:00-18:00 أو راحة` };
  if (!breakPart) return { cell: { start: shift[0], end: shift[1] } };
  const br = range(breakPart);
  if (!br) return { error: `وقت الاستراحة في «${raw.trim()}» غير صالح؛ اكتب مثل 14:00-14:30` };
  return { cell: { start: shift[0], end: shift[1], breakStart: br[0], breakEnd: br[1] } };
}

export function formatCell(cell: Cell) {
  if (!cell) return "";
  if (cell.off) return "راحة";
  return cell.breakStart && cell.breakEnd
    ? `${cell.start}-${cell.end} / ${cell.breakStart}-${cell.breakEnd}`
    : `${cell.start}-${cell.end}`;
}

const csvField = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const HEADER = ["رقم الموظف (لا تعدّله)", "الموظف", "قائد الوردية", ...DAY_NAMES];

/** CSV with a byte-order mark so Excel shows Arabic correctly. */
export function templateToCsv(template: Template, people: Person[]) {
  const lines = [HEADER.map(csvField).join(",")];
  for (const row of template.rows) {
    const name = people.find((p) => p.id === row.userId)?.name ?? "";
    lines.push(
      [row.userId, name, row.lead ? "نعم" : "", ...row.days.map(formatCell)]
        .map(csvField)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function splitCsv(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length,
  )[0]!;
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export type ImportError = { line: number; column: string; message: string };

/** Reads an uploaded template. Rows are matched by employee number, then by exact name. */
export function parseTemplateCsv(text: string, people: Person[]) {
  const rows = splitCsv(text.replace(/^﻿/, ""));
  const errors: ImportError[] = [];
  const out: TemplateRow[] = [];
  if (!rows.length)
    return { template: null, errors: [{ line: 1, column: "", message: "الملف فارغ" }] };
  const header = rows[0]!.map((h) => h.trim());
  const dayCol = DAY_NAMES.map((d) => header.findIndex((h) => h === d));
  if (dayCol.some((i) => i < 0))
    return {
      template: null,
      errors: [
        {
          line: 1,
          column: "",
          message: "أعمدة الأيام غير موجودة؛ استخدم القالب المُنزَّل من النظام",
        },
      ],
    };
  const idCol = header.findIndex((h) => h.startsWith("رقم الموظف"));
  const nameCol = header.findIndex((h) => h === "الموظف");
  const leadCol = header.findIndex((h) => h === "قائد الوردية");
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const id = (r[idCol] ?? "").trim(),
      name = (r[nameCol] ?? "").trim();
    const person =
      people.find((p) => id && p.id === id) ?? people.find((p) => name && p.name.trim() === name);
    if (!person) {
      errors.push({
        line,
        column: "الموظف",
        message: `الموظف «${name || id}» غير موجود في النظام`,
      });
      return;
    }
    if (seen.has(person.id)) {
      errors.push({ line, column: "الموظف", message: `«${person.name}» مكرر في الملف` });
      return;
    }
    seen.add(person.id);
    const days: Cell[] = [];
    dayCol.forEach((col, d) => {
      const parsed = parseCell(r[col] ?? "");
      if ("error" in parsed) {
        errors.push({ line, column: DAY_NAMES[d]!, message: parsed.error });
        days.push(null);
      } else days.push(parsed.cell);
    });
    days.forEach((cell, d) => {
      const prev = d > 0 ? days[d - 1] : null;
      if (cell && !cell.off && prev && !prev.off && prev.end <= prev.start && cell.start < prev.end)
        errors.push({
          line,
          column: DAY_NAMES[d]!,
          message: `وردية ${DAY_NAMES[d]} تبدأ قبل انتهاء وردية الليلة السابقة (${prev.end})`,
        });
    });
    const lead = ["نعم", "yes", "1", "true", "✓"].includes((r[leadCol] ?? "").trim().toLowerCase());
    out.push({ userId: person.id, lead, days });
  });
  if (!out.length && !errors.length)
    errors.push({ line: 2, column: "", message: "لا توجد صفوف موظفين في الملف" });
  return { template: errors.length ? null : { rows: out, rotate: false }, rows: out, errors };
}

const hhmm = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Riyadh",
  }).format(new Date(iso));
const riyadhDayOf = (iso: string) =>
  new Date(+new Date(iso) + 3 * 3600000).toISOString().slice(0, 10);

/** Turns a week that is already scheduled into a template, to export and reuse. */
export function templateFromWeek(
  shifts: {
    userId: string;
    start: string;
    end: string;
    breakStart: string | null;
    breakEnd: string | null;
    dayOff?: boolean;
    lead?: boolean;
  }[],
  people: Person[],
  sunday: string,
): Template {
  const days = Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
  return {
    rotate: false,
    rows: people.map((p) => {
      const own = shifts.filter((s) => s.userId === p.id);
      return {
        userId: p.id,
        lead: own.some((s) => s.lead),
        days: days.map((day): Cell => {
          // Days off are saved as running until midnight at the end of their day.
          const off = own.find((s) => s.dayOff && s.end === riyadhISO(addDays(day, 1)));
          if (off) return { off: true };
          const s = own.find((x) => !x.dayOff && riyadhDayOf(x.start) === day);
          if (!s) return null;
          return {
            start: hhmm(s.start),
            end: hhmm(s.end),
            ...(s.breakStart && s.breakEnd
              ? { breakStart: hhmm(s.breakStart), breakEnd: hhmm(s.breakEnd) }
              : {}),
          };
        }),
      };
    }),
  };
}

/** Shifts for one week from the template; with `rotate`, rows move down one person each week. */
export function templateEntries(
  template: Template,
  sunday: string,
  week: number,
  busy: (userId: string, from: string, to: string) => boolean = () => false,
) {
  const entries: Entry[] = [];
  const skipped: { userId: string; day: string }[] = [];
  // Shift leads keep their own row; only the other rows rotate among themselves.
  const pool = template.rows.filter((r) => !r.lead);
  const m = pool.length;
  const rowFor = (person: TemplateRow, offset: number) => {
    if (!template.rotate || person.lead || !m) return person;
    return pool[(((pool.indexOf(person) + offset) % m) + m) % m]!;
  };
  template.rows.forEach((person) => {
    const pattern = rowFor(person, week);
    const before = rowFor(person, week - 1);
    const last = before.days[6];
    let lastEnd =
      last && !last.off && last.end <= last.start ? Date.parse(riyadhISO(sunday, last.end)) : 0;
    pattern.days.forEach((cell, d) => {
      const day = addDays(sunday, d);
      if (!cell) {
        lastEnd = 0;
        return;
      }
      let e: Omit<Entry, "userId" | "lead" | "dayOff">;
      if (cell.off) {
        e = {
          start: new Date(Math.max(Date.parse(riyadhISO(day)), lastEnd)).toISOString(),
          end: riyadhISO(addDays(day, 1)),
          breakStart: null,
          breakEnd: null,
        };
      } else {
        const start = riyadhISO(day, cell.start);
        const end = riyadhISO(cell.end <= cell.start ? addDays(day, 1) : day, cell.end);
        let bs: string | null = null,
          be: string | null = null;
        if (cell.breakStart && cell.breakEnd) {
          bs = riyadhISO(cell.breakStart < cell.start ? addDays(day, 1) : day, cell.breakStart);
          be = riyadhISO(cell.breakEnd < cell.start ? addDays(day, 1) : day, cell.breakEnd);
          if (
            Date.parse(be) <= Date.parse(bs) ||
            Date.parse(bs) < Date.parse(start) ||
            Date.parse(be) > Date.parse(end)
          )
            bs = be = null;
        }
        e = { start, end, breakStart: bs, breakEnd: be };
      }
      lastEnd = cell.off ? 0 : Date.parse(e.end);
      if (busy(person.userId, e.start, e.end)) {
        skipped.push({ userId: person.userId, day });
        return;
      }
      entries.push({
        userId: person.userId,
        ...e,
        lead: !cell.off && person.lead,
        dayOff: !!cell.off,
      });
    });
  });
  return { entries, skipped };
}
