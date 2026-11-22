/*
 * The report exports (complaints, maintenance, IT) as one shape: a summary
 * sheet (filters, totals, breakdowns by brand, region, branch…) and a detail
 * sheet with one row per item, named by brand, region, city and branch rather
 * than by codes. The same rows give the Excel file and the CSV file.
 * No customer personal data is ever included.
 */
import { safeCell } from "./domain";
import {
  itCategoryText,
  itLate,
  itPriorityLabels,
  itStateLabels,
  type ItCategory,
  type ItDepartment,
  type ItTicket,
} from "./it";
import {
  maintenanceCategoryText,
  maintenanceLate,
  maintenancePriorityLabels,
  maintenanceStateLabels,
  type MaintenanceCategory,
  type MaintenanceRequest,
} from "./maintenance";
import { regionLabel } from "./regions";
import { buildXlsx, type XCell, type XKind, type XRow, type XSheet } from "./xlsx";

export type ExportColumn = { header: string; width: number; kind?: XKind };
export type ExportTable = {
  title: string;
  columns: ExportColumn[];
  rows: XCell[][];
  total?: XCell[];
};
export type ExportBook = {
  title: string;
  /** File name without extension. */
  fileName: string;
  meta: [string, string][];
  details: ExportTable;
  summaries: ExportTable[];
};

export type BranchInfo = {
  id: string;
  name: string;
  code: string;
  city: string;
  region: string | null;
  brandId: string;
};

/* ---- formatting ---- */
/** "2026-11-22 14:05" in Riyadh time. */
export const riyadhTime = (iso: string | null | undefined) =>
  iso ? new Date(+new Date(iso) + 3 * 3600000).toISOString().slice(0, 16).replace("T", " ") : "";
const hoursBetween = (from: string, to: string | null) =>
  to ? Math.max(0, Math.round(((+new Date(to) - +new Date(from)) / 3600000) * 10) / 10) : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  return Math.round(v * 10) / 10;
};
const yes = (v: boolean) => (v ? "نعم" : "لا");
const labelOf = (list: { id: string; label: string }[], id: string) =>
  list.find((c) => c.id === id)?.label ?? id;

/* ---- grouping ---- */
type Measure<T> = {
  header: string;
  width?: number;
  kind?: XKind;
  value: (items: T[]) => number | null;
};
function groupTable<T>(
  title: string,
  items: T[],
  keyOf: (t: T) => string,
  labels: { columns: ExportColumn[]; cells: (key: string, sample: T) => XCell[] },
  measures: Measure<T>[],
): ExportTable {
  const groups = new Map<string, T[]>();
  for (const t of items) {
    const k = keyOf(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const rows = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, list]) => [...labels.cells(k, list[0]!), ...measures.map((m) => m.value(list))]);
  return {
    title,
    columns: [
      ...labels.columns,
      ...measures.map((m) => ({
        header: m.header,
        width: m.width ?? 13,
        kind: m.kind ?? "number",
      })),
    ],
    rows,
    total: [
      "الإجمالي",
      ...labels.columns.slice(1).map(() => null),
      ...measures.map((m) => m.value(items)),
    ],
  };
}

/* ---- output ---- */
export function bookToSheets(book: ExportBook): XSheet[] {
  const summaryWidth = Math.max(2, ...book.summaries.map((t) => t.columns.length));
  const widths = Array.from({ length: summaryWidth }, (_, i) =>
    Math.max(i === 0 ? 24 : 12, ...book.summaries.map((t) => t.columns[i]?.width ?? 0)),
  );
  const rows: XRow[] = [
    { cells: [book.title], style: "title" },
    ...book.meta.map(([k, v]) => ({ cells: [k, v], style: "meta" as const })),
  ];
  const sections: { row: number; cols: number }[] = [];
  for (const t of book.summaries) {
    rows.push({ cells: [] });
    rows.push({ cells: [t.title], style: "section" });
    sections.push({ row: rows.length, cols: t.columns.length });
    rows.push({ cells: t.columns.map((c) => c.header), style: "header" });
    const kinds = t.columns.map((c) => c.kind ?? "text");
    for (const r of t.rows) rows.push({ cells: r, kinds });
    if (t.total && t.rows.length > 1) rows.push({ cells: t.total, style: "total", kinds });
  }
  const d = book.details;
  return [
    { name: "الملخص", widths, rows, mergeRows: [1, ...sections] },
    {
      name: "التفاصيل",
      widths: d.columns.map((c) => c.width),
      rows: [
        { cells: d.columns.map((c) => c.header), style: "header" },
        ...d.rows.map((r) => ({ cells: r, kinds: d.columns.map((c) => c.kind ?? "text") })),
      ],
      freezeRow: 2,
      filterRow: 1,
    },
  ];
}

export const bookToXlsx = (book: ExportBook, when = new Date()) =>
  buildXlsx(bookToSheets(book), when);

/** The detail rows as CSV (UTF-8 with BOM so Excel shows Arabic correctly). */
export function bookToCsv(book: ExportBook) {
  const d = book.details;
  const cell = (v: XCell, kind?: XKind) =>
    v === null ? "" : kind === "percent" && typeof v === "number" ? Math.round(v * 100) + "%" : v;
  const lines = [
    d.columns.map((c) => c.header),
    ...d.rows.map((r) => r.map((v, i) => cell(v, d.columns[i]?.kind))),
  ];
  return "﻿" + lines.map((row) => row.map(safeCell).join(",")).join("\r\n");
}

/* ---- shared place columns ---- */
const placeColumns: ExportColumn[] = [
  { header: "العلامة", width: 16 },
  { header: "المنطقة", width: 20 },
  { header: "المدينة", width: 14 },
  { header: "الفرع", width: 22 },
  { header: "رمز الفرع", width: 12 },
];
function places(branches: BranchInfo[], brandName: (id: string | null) => string) {
  const branchOf = (id: string | null) => (id ? branches.find((b) => b.id === id) : undefined);
  const cells = (brandId: string | null, branchId: string | null, none = "غير محدد"): XCell[] => {
    const b = branchOf(branchId);
    return [
      brandId ? brandName(brandId) : "",
      b ? regionLabel(b.region) || "غير محددة" : "",
      b?.city ?? "",
      b?.name ?? (branchId ? "فرع محذوف" : none),
      b?.code ?? "",
    ];
  };
  const regionOf = (id: string | null) => {
    const b = branchOf(id);
    return b ? regionLabel(b.region) || "غير محددة" : "بدون فرع";
  };
  return { branchOf, cells, regionOf };
}

/* ---- complaints ---- */
export const complaintStageLabels: Record<string, string> = {
  NEW: "استقبال الشكوى",
  TRIAGED: "استقبال الشكوى",
  ASSIGNED: "الإسناد",
  ACKNOWLEDGED: "جارٍ العمل",
  IN_PROGRESS: "جارٍ العمل",
  RESOLVED: "التواصل مع العميل",
  CLOSED: "تم الحل",
};
export const complaintSourceLabels: Record<string, string> = {
  PUBLIC_QR: "رمز QR",
  PHONE_AGENT: "اتصال هاتفي",
  GOOGLE_REVIEW: "تقييم Google",
};
export const complaintPriorityLabels: Record<string, string> = {
  P1: "حرجة",
  P2: "مرتفعة",
  P3: "عادية",
};
const KIND_TITLE = { complaint: "الشكاوى", suggestion: "الاقتراحات", all: "الشكاوى والاقتراحات" };

export type ComplaintExportRow = {
  number: string;
  brandId: string;
  branchId: string | null;
  state: string;
  source: string;
  category: string;
  priority: string;
  escalated: boolean;
  platform: string | null;
  owner: string;
  receivedAt: string;
  closedAt: string | null;
};

export function complaintsBook(input: {
  rows: ComplaintExportRow[];
  branches: BranchInfo[];
  brandName: (id: string | null) => string;
  personName: (id: string) => string;
  reasonOf: (id: string) => string;
  from: string;
  to: string;
  kind: "complaint" | "suggestion" | "all";
  filters: { brand?: string; branch?: string; source?: string; priority?: string };
  generatedAt?: Date;
}): ExportBook {
  const { rows } = input;
  const p = places(input.branches, input.brandName);
  const closed = (t: ComplaintExportRow) => t.state === "CLOSED";
  const fixHours = (list: ComplaintExportRow[]) =>
    median(
      list
        .filter((t) => closed(t) && t.closedAt)
        .map((t) => hoursBetween(t.receivedAt, t.closedAt)!),
    );
  const measures: Measure<ComplaintExportRow>[] = [
    { header: "الإجمالي", value: (l) => l.length },
    { header: "مفتوحة", value: (l) => l.filter((t) => !closed(t)).length },
    { header: "تم الحل", value: (l) => l.filter(closed).length },
    { header: "مصعّدة", value: (l) => l.filter((t) => t.escalated).length },
    {
      header: "نسبة الحل",
      kind: "percent",
      value: (l) => (l.length ? l.filter(closed).length / l.length : null),
    },
    { header: "الوقت المعتاد للحل (ساعة)", width: 16, kind: "hours", value: fixHours },
  ];
  const title = "تقرير " + KIND_TITLE[input.kind];
  const one = (header: string, width = 24) => ({ columns: [{ header, width }] });
  return {
    title: title + " — أليز غلوب",
    fileName: `aliz-${input.kind === "suggestion" ? "suggestions" : "complaints"}-${input.from}-${input.to}`,
    meta: [
      ["الفترة", `${input.from} إلى ${input.to} (حسب تاريخ الاستقبال، توقيت الرياض)`],
      ["العلامة", input.filters.brand ?? "جميع العلامات"],
      ["الفرع", input.filters.branch ?? "جميع الفروع"],
      [
        "المصدر",
        input.filters.source
          ? (complaintSourceLabels[input.filters.source] ?? input.filters.source)
          : "جميع المصادر",
      ],
      [
        "الأولوية",
        input.filters.priority
          ? (complaintPriorityLabels[input.filters.priority] ?? input.filters.priority)
          : "جميع الأولويات",
      ],
      ["عدد السجلات", String(rows.length)],
      ["تاريخ الإصدار", riyadhTime((input.generatedAt ?? new Date()).toISOString())],
      ["ملاحظة", "لا يتضمن التقرير بيانات العملاء الشخصية."],
    ],
    summaries: [
      groupTable(
        "حسب العلامة",
        rows,
        (t) => t.brandId,
        { columns: [{ header: "العلامة", width: 24 }], cells: (k) => [input.brandName(k)] },
        measures,
      ),
      groupTable(
        "حسب المنطقة",
        rows,
        (t) => p.regionOf(t.branchId),
        { columns: [{ header: "المنطقة", width: 24 }], cells: (k) => [k] },
        measures,
      ),
      groupTable(
        "حسب الفرع",
        rows,
        (t) => t.branchId ?? "NONE",
        {
          columns: [
            { header: "الفرع", width: 24 },
            { header: "العلامة", width: 16 },
            { header: "المنطقة", width: 20 },
            { header: "المدينة", width: 14 },
          ],
          cells: (_k, t) => {
            const [brand, region, city, branch] = p.cells(t.brandId, t.branchId);
            return [branch!, brand!, region!, city!];
          },
        },
        measures,
      ),
      groupTable(
        "حسب سبب الشكوى",
        rows,
        (t) => t.category,
        { ...one("السبب"), cells: (k) => [input.reasonOf(k)] },
        measures,
      ),
      groupTable(
        "حسب المصدر",
        rows,
        (t) => t.source,
        { ...one("المصدر"), cells: (k) => [complaintSourceLabels[k] ?? k] },
        measures,
      ),
      groupTable(
        "حسب الأولوية",
        rows,
        (t) => t.priority,
        { ...one("الأولوية"), cells: (k) => [complaintPriorityLabels[k] ?? k] },
        measures,
      ),
    ],
    details: {
      title: "التفاصيل",
      columns: [
        { header: "رقم الشكوى", width: 12 },
        { header: "تاريخ الاستقبال", width: 18 },
        ...placeColumns,
        { header: "النوع", width: 10 },
        { header: "السبب", width: 20 },
        { header: "المصدر", width: 14 },
        { header: "منصة الطلب", width: 14 },
        { header: "الأولوية", width: 10 },
        { header: "المرحلة", width: 18 },
        { header: "مصعّدة", width: 9 },
        { header: "مسؤول التواصل", width: 18 },
        { header: "تاريخ الحل", width: 18 },
        { header: "مدة الحل (ساعة)", width: 14, kind: "hours" },
      ],
      rows: rows.map((t) => [
        t.number,
        riyadhTime(t.receivedAt),
        ...p.cells(t.brandId, t.branchId),
        t.category === "SUGGESTION" ? "اقتراح" : "شكوى",
        input.reasonOf(t.category),
        complaintSourceLabels[t.source] ?? t.source,
        t.platform ?? "",
        complaintPriorityLabels[t.priority] ?? t.priority,
        complaintStageLabels[t.state] ?? t.state,
        yes(t.escalated),
        t.owner === "UNASSIGNED" ? "غير مسند" : input.personName(t.owner),
        closed(t) ? riyadhTime(t.closedAt) : "",
        closed(t) ? hoursBetween(t.receivedAt, t.closedAt) : null,
      ]),
    },
  };
}

/* ---- maintenance and IT ---- */
type Work = MaintenanceRequest | ItTicket;
const workMeasures = <T extends Work>(late: (t: T) => unknown): Measure<T>[] => {
  const fixed = (t: T) => t.state === "DONE" || t.state === "CONFIRMED";
  const open = (t: T) => !["DONE", "CONFIRMED", "CANCELLED"].includes(t.state);
  const lateNow = (t: T) =>
    !!late(t) || (!!t.doneAt && !!t.fixDueAt && +new Date(t.doneAt) > +new Date(t.fixDueAt));
  return [
    { header: "الإجمالي", value: (l) => l.length },
    { header: "مفتوحة", value: (l) => l.filter(open).length },
    { header: "تم الحل", value: (l) => l.filter(fixed).length },
    { header: "متأخرة", value: (l) => l.filter(lateNow).length },
    {
      header: "ضمن المهلة",
      kind: "percent",
      value: (l) => {
        const done = l.filter((t) => fixed(t) && t.doneAt);
        return done.length
          ? done.filter((t) => !t.fixDueAt || +new Date(t.doneAt!) <= +new Date(t.fixDueAt))
              .length / done.length
          : null;
      },
    },
    {
      header: "الوقت المعتاد للحل (ساعة)",
      width: 16,
      kind: "hours",
      value: (l) =>
        median(
          l.filter((t) => fixed(t) && t.doneAt).map((t) => hoursBetween(t.createdAt, t.doneAt)!),
        ),
    },
  ];
};

type WorkInput = {
  branches: BranchInfo[];
  brandName: (id: string | null) => string;
  personName: (id: string | null) => string;
  from: string;
  to: string;
  filters: { brand?: string; branch?: string; department?: string };
  generatedAt?: Date;
};

export function maintenanceBook(
  input: WorkInput & {
    rows: MaintenanceRequest[];
    categories: MaintenanceCategory[];
    numberOf: (n: number) => string;
  },
): ExportBook {
  const { rows } = input;
  const p = places(input.branches, input.brandName);
  const measures = workMeasures<MaintenanceRequest>((r) => maintenanceLate(r));
  const category = (r: MaintenanceRequest) => maintenanceCategoryText(r, input.categories);
  return {
    title: "تقرير الصيانة — أليز غلوب",
    fileName: `aliz-maintenance-${input.from}-${input.to}`,
    meta: [
      ["الفترة", `${input.from} إلى ${input.to} (حسب تاريخ الطلب، توقيت الرياض)`],
      ["العلامة", input.filters.brand ?? "جميع العلامات"],
      ["الفرع", input.filters.branch ?? "جميع الفروع"],
      ["عدد الطلبات", String(rows.length)],
      ["تاريخ الإصدار", riyadhTime((input.generatedAt ?? new Date()).toISOString())],
    ],
    summaries: [
      groupTable(
        "حسب العلامة",
        rows,
        (r) => r.brandId,
        { columns: [{ header: "العلامة", width: 24 }], cells: (k) => [input.brandName(k)] },
        measures,
      ),
      groupTable(
        "حسب المنطقة",
        rows,
        (r) => p.regionOf(r.branchId),
        { columns: [{ header: "المنطقة", width: 24 }], cells: (k) => [k] },
        measures,
      ),
      groupTable(
        "حسب الفرع",
        rows,
        (r) => r.branchId,
        {
          columns: [
            { header: "الفرع", width: 24 },
            { header: "العلامة", width: 16 },
            { header: "المنطقة", width: 20 },
            { header: "المدينة", width: 14 },
          ],
          cells: (_k, r) => {
            const [brand, region, city, branch] = p.cells(r.brandId, r.branchId);
            return [branch!, brand!, region!, city!];
          },
        },
        measures,
      ),
      groupTable(
        "حسب نوع العطل",
        rows,
        (r) => r.category,
        {
          columns: [{ header: "نوع العطل", width: 24 }],
          cells: (k) => [labelOf(input.categories, k)],
        },
        measures,
      ),
      groupTable(
        "حسب الفني",
        rows,
        (r) => r.assignee ?? "",
        {
          columns: [{ header: "الفني", width: 24 }],
          cells: (k) => [k ? input.personName(k) : "غير مسند"],
        },
        measures,
      ),
    ],
    details: {
      title: "التفاصيل",
      columns: [
        { header: "رقم الطلب", width: 11 },
        { header: "تاريخ الطلب", width: 18 },
        ...placeColumns,
        { header: "نوع العطل", width: 18 },
        { header: "العنوان", width: 30 },
        { header: "الأولوية", width: 10 },
        { header: "الحالة", width: 14 },
        { header: "متأخر", width: 8 },
        { header: "طلبه", width: 18 },
        { header: "الفني", width: 18 },
        { header: "بدء العمل", width: 18 },
        { header: "تم الإصلاح", width: 18 },
        { header: "تأكيد الفرع", width: 18 },
        { header: "مهلة الإصلاح", width: 18 },
        { header: "ساعات حتى الإصلاح", width: 14, kind: "hours" },
      ],
      rows: rows.map((r) => [
        input.numberOf(r.number),
        riyadhTime(r.createdAt),
        ...p.cells(r.brandId, r.branchId),
        category(r),
        r.title,
        maintenancePriorityLabels[r.priority],
        maintenanceStateLabels[r.state],
        yes(
          !!maintenanceLate(r) ||
            (!!r.doneAt && !!r.fixDueAt && +new Date(r.doneAt) > +new Date(r.fixDueAt)),
        ),
        input.personName(r.requester),
        input.personName(r.assignee),
        riyadhTime(r.startedAt),
        riyadhTime(r.doneAt),
        riyadhTime(r.confirmedAt),
        riyadhTime(r.fixDueAt),
        hoursBetween(r.createdAt, r.doneAt),
      ]),
    },
  };
}

export function itBook(
  input: WorkInput & {
    rows: ItTicket[];
    categories: ItCategory[];
    departments: ItDepartment[];
    numberOf: (n: number) => string;
  },
): ExportBook {
  const { rows } = input;
  const p = places(input.branches, input.brandName);
  const measures = workMeasures<ItTicket>((t) => itLate(t));
  const department = (id: string) => input.departments.find((d) => d.id === id)?.label ?? id;
  const category = (t: ItTicket) => itCategoryText(t, input.categories);
  return {
    title: "تقرير الدعم الفني — أليز غلوب",
    fileName: `aliz-it-${input.from}-${input.to}`,
    meta: [
      ["الفترة", `${input.from} إلى ${input.to} (حسب تاريخ فتح التذكرة، توقيت الرياض)`],
      ["القسم", input.filters.department ?? "جميع الأقسام"],
      ["الفرع", input.filters.branch ?? "جميع الفروع"],
      ["عدد التذاكر", String(rows.length)],
      ["تاريخ الإصدار", riyadhTime((input.generatedAt ?? new Date()).toISOString())],
    ],
    summaries: [
      groupTable(
        "حسب القسم",
        rows,
        (t) => t.department,
        { columns: [{ header: "القسم", width: 24 }], cells: (k) => [department(k)] },
        measures,
      ),
      groupTable(
        "حسب المنطقة",
        rows,
        (t) => p.regionOf(t.branchId),
        { columns: [{ header: "المنطقة", width: 24 }], cells: (k) => [k] },
        measures,
      ),
      groupTable(
        "حسب الفرع",
        rows,
        (t) => t.branchId ?? "NONE",
        {
          columns: [
            { header: "الفرع", width: 24 },
            { header: "العلامة", width: 16 },
            { header: "المنطقة", width: 20 },
            { header: "المدينة", width: 14 },
          ],
          cells: (_k, t) => {
            const [brand, region, city, branch] = p.cells(
              t.brandId,
              t.branchId,
              "بدون فرع (الإدارة)",
            );
            return [branch!, brand!, region!, city!];
          },
        },
        measures,
      ),
      groupTable(
        "حسب نوع المشكلة",
        rows,
        (t) => t.category,
        {
          columns: [{ header: "نوع المشكلة", width: 24 }],
          cells: (k) => [labelOf(input.categories, k)],
        },
        measures,
      ),
      groupTable(
        "حسب المختص",
        rows,
        (t) => t.assignee ?? "",
        {
          columns: [{ header: "المختص", width: 24 }],
          cells: (k) => [k ? input.personName(k) : "غير مسند"],
        },
        measures,
      ),
    ],
    details: {
      title: "التفاصيل",
      columns: [
        { header: "رقم التذكرة", width: 11 },
        { header: "تاريخ الفتح", width: 18 },
        { header: "القسم", width: 16 },
        ...placeColumns,
        { header: "نوع المشكلة", width: 18 },
        { header: "العنوان", width: 30 },
        { header: "الأولوية", width: 10 },
        { header: "الحالة", width: 14 },
        { header: "متأخرة", width: 8 },
        { header: "مقدم الطلب", width: 18 },
        { header: "المختص", width: 18 },
        { header: "بدء العمل", width: 18 },
        { header: "تم الحل", width: 18 },
        { header: "تأكيد مقدم الطلب", width: 18 },
        { header: "مهلة الحل", width: 18 },
        { header: "ساعات حتى الحل", width: 14, kind: "hours" },
      ],
      rows: rows.map((t) => [
        input.numberOf(t.number),
        riyadhTime(t.createdAt),
        department(t.department),
        ...p.cells(t.brandId, t.branchId, "بدون فرع (الإدارة)"),
        category(t),
        t.title,
        itPriorityLabels[t.priority],
        itStateLabels[t.state],
        yes(
          !!itLate(t) ||
            (!!t.doneAt && !!t.fixDueAt && +new Date(t.doneAt) > +new Date(t.fixDueAt)),
        ),
        input.personName(t.requester),
        input.personName(t.assignee),
        riyadhTime(t.startedAt),
        riyadhTime(t.doneAt),
        riyadhTime(t.confirmedAt),
        riyadhTime(t.fixDueAt),
        hoursBetween(t.createdAt, t.doneAt),
      ]),
    },
  };
}
