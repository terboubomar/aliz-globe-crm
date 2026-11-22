import { describe, expect, it } from "vitest";
import {
  bookToCsv,
  bookToSheets,
  bookToXlsx,
  complaintsBook,
  itBook,
  maintenanceBook,
  type BranchInfo,
  type ComplaintExportRow,
} from "@/lib/report-export";
import { crc32 } from "@/lib/xlsx";
import { toItSettings, itNumber, type ItTicket } from "@/lib/it";
import {
  maintenanceNumber,
  toMaintenanceSettings,
  type MaintenanceRequest,
} from "@/lib/maintenance";

const branches: BranchInfo[] = [
  { id: "b1", name: "سيهات", code: "WQF-SEH", city: "سيهات", region: "EASTERN", brandId: "waqf" },
  { id: "b2", name: "النرجس", code: "WQF-RYD", city: "الرياض", region: "RIYADH", brandId: "waqf" },
];
const brandName = (id: string | null) => (id === "waqf" ? "برجر واقف" : (id ?? ""));
const row = (over: Partial<ComplaintExportRow> = {}): ComplaintExportRow => ({
  number: "1",
  brandId: "waqf",
  branchId: "b1",
  state: "CLOSED",
  source: "PUBLIC_QR",
  category: "QUALITY",
  priority: "P2",
  escalated: false,
  platform: "جاهز",
  owner: "u1",
  receivedAt: "2026-11-10T07:00:00Z",
  closedAt: "2026-11-10T09:30:00Z",
  ...over,
});
const book = (rows: ComplaintExportRow[]) =>
  complaintsBook({
    rows,
    branches,
    brandName,
    personName: (id) => (id === "u1" ? "نورة" : "موظف"),
    reasonOf: (id) => (id === "QUALITY" ? "جودة الطعام" : id),
    from: "2026-11-01",
    to: "2026-11-22",
    kind: "complaint",
    filters: {},
    generatedAt: new Date("2026-11-22T10:00:00Z"),
  });

/** Text of one part inside the (uncompressed) xlsx zip. */
function part(zip: Uint8Array, name: string) {
  const text = new TextDecoder().decode(zip);
  // The stored file follows its name in the local header.
  const at = text.indexOf(name + "<?xml");
  expect(at).toBeGreaterThan(-1);
  const start = at + name.length;
  return text.slice(start, text.indexOf("PK", start));
}

describe("complaint export", () => {
  it("names the brand, region, city and branch on every row, in Riyadh time", () => {
    const b = book([
      row(),
      row({ number: "2", branchId: "b2", state: "IN_PROGRESS", closedAt: null }),
    ]);
    const headers = b.details.columns.map((c) => c.header);
    expect(headers.slice(0, 7)).toEqual([
      "رقم الشكوى",
      "تاريخ الاستقبال",
      "العلامة",
      "المنطقة",
      "المدينة",
      "الفرع",
      "رمز الفرع",
    ]);
    expect(b.details.rows[0]!.slice(0, 7)).toEqual([
      "1",
      "2026-11-10 10:00",
      "برجر واقف",
      "المنطقة الشرقية",
      "سيهات",
      "سيهات",
      "WQF-SEH",
    ]);
    expect(b.details.rows[0]).toContain("رمز QR");
    expect(b.details.rows[0]).toContain("نورة");
    expect(b.details.rows[0]!.at(-1)).toBe(2.5);
    // Open complaints have no solve time.
    expect(b.details.rows[1]!.at(-1)).toBeNull();
  });

  it("summarises by brand, region and branch with totals", () => {
    const b = book([
      row(),
      row({ number: "2", branchId: "b2", state: "NEW", closedAt: null, escalated: true }),
      row({ number: "3", branchId: null, state: "NEW", closedAt: null }),
    ]);
    expect(b.summaries.map((s) => s.title)).toEqual([
      "حسب العلامة",
      "حسب المنطقة",
      "حسب الفرع",
      "حسب سبب الشكوى",
      "حسب المصدر",
      "حسب الأولوية",
    ]);
    const region = b.summaries[1]!;
    expect(region.rows.map((r) => r[0])).toEqual(["المنطقة الشرقية", "منطقة الرياض", "بدون فرع"]);
    expect(region.total!.slice(0, 5)).toEqual(["الإجمالي", 3, 2, 1, 1]);
    const branch = b.summaries[2]!;
    expect(branch.columns.slice(0, 4).map((c) => c.header)).toEqual([
      "الفرع",
      "العلامة",
      "المنطقة",
      "المدينة",
    ]);
    expect(branch.rows.map((r) => r[0])).toContain("غير محدد");
  });

  it("never includes customer details", () => {
    const text = JSON.stringify(book([row()]));
    expect(text).not.toMatch(/phone|customer|هاتف العميل/i);
  });
});

describe("csv", () => {
  it("has a BOM, quotes every cell and neutralises formulas", () => {
    const csv = bookToCsv(book([row({ platform: "=HYPERLINK(1)" })]));
    expect(csv.startsWith("﻿")).toBe(true);
    const [header, first] = csv.slice(1).split("\r\n");
    expect(header!.startsWith('"رقم الشكوى","تاريخ الاستقبال","العلامة"')).toBe(true);
    expect(first).toContain(`"'=HYPERLINK(1)"`);
  });
});

describe("xlsx", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes a zip with a right-to-left summary sheet and a filterable detail sheet", () => {
    const zip = bookToXlsx(book([row(), row({ number: "2" })]), new Date("2026-11-22T10:00:00Z"));
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    const workbook = part(zip, "xl/workbook.xml");
    expect(workbook).toContain('name="الملخص"');
    expect(workbook).toContain('name="التفاصيل"');
    const details = part(zip, "xl/worksheets/sheet2.xml");
    expect(details).toContain('rightToLeft="1"');
    expect(details).toContain('state="frozen"');
    expect(details).toContain('<autoFilter ref="A1:Q3"/>');
    expect(details).toContain("برجر واقف");
    // Numbers stay numbers so Excel can sum them.
    expect(details).toMatch(/<c r="Q2" s="7"><v>2.5<\/v><\/c>/);
  });

  it("escapes XML special characters", () => {
    const sheets = bookToSheets(book([row({ platform: 'A & B <"x">' })]));
    const zip = bookToXlsx(book([row({ platform: 'A & B <"x">' })]));
    expect(sheets[1]!.rows[1]!.cells).toContain('A & B <"x">');
    expect(part(zip, "xl/worksheets/sheet2.xml")).toContain("A &amp; B &lt;&quot;x&quot;&gt;");
  });
});

describe("maintenance and IT exports", () => {
  const base = {
    id: "x",
    number: 7,
    categoryDetail: null,
    priority: "NORMAL" as const,
    title: "عطل",
    description: "",
    state: "DONE" as const,
    requester: "r",
    assignee: "t",
    respondDueAt: null,
    fixDueAt: "2026-11-10T12:00:00Z",
    createdAt: "2026-11-10T07:00:00Z",
    assignedAt: null,
    startedAt: null,
    doneAt: "2026-11-10T10:00:00Z",
    confirmedAt: null,
    version: 1,
  };
  const common = {
    branches,
    brandName,
    personName: (id: string | null) => (id ? "أحمد" : ""),
    from: "2026-11-01",
    to: "2026-11-22",
    filters: {},
  };

  it("maintenance rows carry the region and city", () => {
    const req: MaintenanceRequest = { ...base, brandId: "waqf", branchId: "b2", category: "AC" };
    const b = maintenanceBook({
      ...common,
      rows: [req],
      categories: toMaintenanceSettings(null).categories,
      numberOf: maintenanceNumber,
    });
    expect(b.details.rows[0]!.slice(0, 7)).toEqual([
      "M-0007",
      "2026-11-10 10:00",
      "برجر واقف",
      "منطقة الرياض",
      "الرياض",
      "النرجس",
      "WQF-RYD",
    ]);
    expect(b.details.columns.map((c) => c.header)).not.toContain("معرّف الفرع");
  });

  it("IT tickets without a branch say so", () => {
    const t: ItTicket = {
      ...base,
      brandId: null,
      branchId: null,
      department: "FINANCE",
      category: "PRINTER",
    };
    const s = toItSettings(null);
    const b = itBook({
      ...common,
      rows: [t],
      categories: s.categories,
      departments: s.departments,
      numberOf: itNumber,
    });
    expect(b.details.rows[0]![0]).toBe("IT-0007");
    expect(b.details.rows[0]).toContain("بدون فرع (الإدارة)");
    expect(b.summaries[0]!.title).toBe("حسب القسم");
  });
});
