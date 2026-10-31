import { describe, expect, it } from "vitest";
import { weekEntries, defaultPlan } from "@/lib/rotation";
import {
  parseCell,
  parseTemplateCsv,
  templateEntries,
  templateFromWeek,
  templateToCsv,
  type Template,
} from "@/lib/schedule-template";

// Schedule template: download, fill in Excel, upload, apply. Synthetic staff.
const people = [
  { id: "11111111-1111-4111-8111-111111111111", name: "سارة" },
  { id: "22222222-2222-4222-8222-222222222222", name: "محمد" },
];
const SUN = "2026-11-01";

describe("reading cells", () => {
  it("accepts shifts, breaks, days off and Arabic digits", () => {
    expect(parseCell("10:00-18:00")).toEqual({ cell: { start: "10:00", end: "18:00" } });
    expect(parseCell("18:00 - 02:00 / 22:00-22:30")).toEqual({
      cell: { start: "18:00", end: "02:00", breakStart: "22:00", breakEnd: "22:30" },
    });
    expect(parseCell("٩:٠٠-١٧:٠٠")).toEqual({ cell: { start: "09:00", end: "17:00" } });
    expect(parseCell("راحة")).toEqual({ cell: { off: true } });
    expect(parseCell("OFF")).toEqual({ cell: { off: true } });
    expect(parseCell("")).toEqual({ cell: null });
    expect("error" in parseCell("صباحي")).toBe(true);
    expect("error" in parseCell("25:00-18:00")).toBe(true);
  });
});

describe("template file", () => {
  const template: Template = {
    rotate: false,
    rows: [
      {
        userId: people[0]!.id,
        lead: true,
        days: [{ off: true }, ...Array(6).fill({ start: "10:00", end: "18:00" })],
      },
      {
        userId: people[1]!.id,
        lead: false,
        days: [...Array(6).fill({ start: "18:00", end: "02:00" }), { off: true }],
      },
    ],
  };

  it("round-trips through the CSV Excel opens", () => {
    const csv = templateToCsv(template, people);
    expect(csv.startsWith("﻿")).toBe(true);
    const back = parseTemplateCsv(csv, people);
    expect(back.errors).toEqual([]);
    expect(back.template!.rows).toEqual(template.rows);
  });

  it("reads files Excel saved with semicolons, matching people by name", () => {
    const csv =
      "الموظف;قائد الوردية;الأحد;الاثنين;الثلاثاء;الأربعاء;الخميس;الجمعة;السبت\nمحمد;;راحة;10:00-18:00;;;;;\n";
    const r = parseTemplateCsv(csv, people);
    expect(r.errors).toEqual([]);
    expect(r.template!.rows[0]!.userId).toBe(people[1]!.id);
  });

  it("points at the exact line and day of each mistake", () => {
    const csv =
      "الموظف,الأحد,الاثنين,الثلاثاء,الأربعاء,الخميس,الجمعة,السبت\n" +
      "سارة,18:00-02:00,01:00-09:00,,,,,\n" +
      "غير موجود,,,,,,,\n";
    const r = parseTemplateCsv(csv, people);
    expect(r.template).toBeNull();
    expect(r.errors.map((e) => [e.line, e.column])).toEqual([
      [2, "الاثنين"],
      [3, "الموظف"],
    ]);
  });
});

describe("applying a template", () => {
  const t: Template = {
    rotate: false,
    rows: [
      {
        userId: "a",
        lead: true,
        days: [{ start: "18:00", end: "02:00" }, { off: true }, null, null, null, null, null],
      },
      {
        userId: "b",
        lead: false,
        days: [{ start: "10:00", end: "18:00" }, null, null, null, null, null, null],
      },
    ],
  };

  it("creates the shifts, starts a day off after the night shift ends, and marks leads", () => {
    const { entries } = templateEntries(t, SUN, 0);
    expect(entries).toHaveLength(3);
    const [night, off] = entries.filter((e) => e.userId === "a");
    expect(night!.lead).toBe(true);
    expect(off!.dayOff).toBe(true);
    expect(off!.start).toBe(night!.end);
  });

  it("repeats every week through the rotation engine, and can rotate rows", () => {
    const plan = { ...defaultPlan(SUN), shifts: [], members: ["a", "b"], template: t };
    const w1 = weekEntries(plan, "2026-11-08").entries;
    expect(w1.filter((e) => e.userId === "b")).toHaveLength(1);
    const rotated = weekEntries(
      { ...plan, template: { rows: t.rows.map((r) => ({ ...r, lead: false })), rotate: true } },
      "2026-11-08",
    ).entries;
    expect(rotated.filter((e) => e.userId === "b")).toHaveLength(2);
  });

  it("keeps shift leads on their own row when rows rotate", () => {
    const three: Template = {
      rotate: true,
      rows: [
        {
          userId: "lead",
          lead: true,
          days: [{ start: "10:00", end: "18:00" }, null, null, null, null, null, null],
        },
        {
          userId: "x",
          lead: false,
          days: [{ start: "12:00", end: "20:00" }, null, null, null, null, null, null],
        },
        {
          userId: "y",
          lead: false,
          days: [{ start: "18:00", end: "02:00" }, null, null, null, null, null, null],
        },
      ],
    };
    const start = (id: string) =>
      templateEntries(three, "2026-11-08", 1).entries.find((e) => e.userId === id)!.start;
    expect(start("lead")).toBe("2026-11-08T07:00:00.000Z");
    expect(start("x")).toBe("2026-11-08T15:00:00.000Z");
    expect(start("y")).toBe("2026-11-08T09:00:00.000Z");
  });

  it("leaves days that already have something alone", () => {
    const busy = (id: string) => id === "b";
    expect(templateEntries(t, SUN, 0, busy).skipped).toEqual([{ userId: "b", day: SUN }]);
  });

  it("exports a scheduled week back into the same template", () => {
    const { entries } = templateEntries(t, SUN, 0);
    const back = templateFromWeek(
      entries,
      [
        { id: "a", name: "a" },
        { id: "b", name: "b" },
      ],
      SUN,
    );
    expect(back.rows.map((r) => r.days)).toEqual(t.rows.map((r) => r.days));
    expect(back.rows[0]!.lead).toBe(true);
  });
});
