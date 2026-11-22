/*
 * A small Excel (.xlsx) writer for the report exports, with no dependency.
 * An .xlsx file is a zip of XML parts; this stores them uncompressed, which
 * Excel, Google Sheets, Numbers and LibreOffice all open. Sheets are right to
 * left, with a styled header row, frozen panes and filters on the data sheet.
 */

export type XCell = string | number | null;
/** How a column's values are shown. */
export type XKind = "text" | "number" | "hours" | "percent";
export type XStyle = "title" | "meta" | "metaValue" | "section" | "header" | "body" | "total";
export type XRow = { cells: XCell[]; style?: XStyle; kinds?: XKind[] };
export type XSheet = {
  name: string;
  widths: number[];
  rows: XRow[];
  /** Freeze the rows above this one (1-based), e.g. 2 keeps the header row in view. */
  freezeRow?: number;
  /** Filter buttons on this header row (1-based). */
  filterRow?: number;
  /** Rows whose first cell spans several columns: a row number (whole width) or { row, cols }. */
  mergeRows?: (number | { row: number; cols: number })[];
};

const esc = (s: string) =>
  s
    // Control characters are not allowed in XML.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/* Style indexes into cellXfs below. */
const XF = {
  body: 0,
  header: 1,
  title: 2,
  section: 3,
  meta: 4,
  metaValue: 5,
  number: 6,
  hours: 7,
  percent: 8,
  total: 9,
  totalNumber: 10,
  totalHours: 11,
  totalPercent: 12,
} as const;

function styleOf(row: XRow, i: number, value: XCell): number {
  const kind = row.kinds?.[i] ?? (typeof value === "number" ? "number" : "text");
  switch (row.style ?? "body") {
    case "title":
      return XF.title;
    case "meta":
      return i === 0 ? XF.meta : XF.metaValue;
    case "metaValue":
      return XF.metaValue;
    case "section":
      return XF.section;
    case "header":
      return XF.header;
    case "total":
      return kind === "hours"
        ? XF.totalHours
        : kind === "percent"
          ? XF.totalPercent
          : kind === "text"
            ? XF.total
            : XF.totalNumber;
    default:
      return kind === "hours"
        ? XF.hours
        : kind === "percent"
          ? XF.percent
          : kind === "number"
            ? XF.number
            : XF.body;
  }
}

function sheetXml(sheet: XSheet) {
  const width = Math.max(sheet.widths.length, ...sheet.rows.map((r) => r.cells.length));
  const last = colName(Math.max(0, width - 1));
  const rows = sheet.rows
    .map((row, r) => {
      const n = r + 1;
      const height =
        row.style === "title"
          ? 30
          : row.style === "header"
            ? 26
            : row.style === "section"
              ? 22
              : 20;
      const cells = row.cells
        .map((v, i) => {
          const ref = colName(i) + n;
          const s = styleOf(row, i, v);
          if (v === null || v === "") return `<c r="${ref}" s="${s}"/>`;
          if (typeof v === "number" && Number.isFinite(v))
            return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
          return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
        })
        .join("");
      return `<row r="${n}" ht="${height}" customHeight="1">${cells}</row>`;
    })
    .join("");
  const freeze = sheet.freezeRow
    ? `<pane ySplit="${sheet.freezeRow - 1}" topLeftCell="A${sheet.freezeRow}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sheet.freezeRow}" sqref="A${sheet.freezeRow}"/>`
    : "";
  const cols = sheet.widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");
  const lastRow = sheet.rows.length;
  const filter =
    sheet.filterRow && lastRow >= sheet.filterRow
      ? `<autoFilter ref="A${sheet.filterRow}:${last}${lastRow}"/>`
      : "";
  const merges = (sheet.mergeRows ?? [])
    .map((m) => (typeof m === "number" ? { row: m, cols: width } : m))
    .filter((m) => m.row <= lastRow && m.cols > 1);
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="A${m.row}:${colName(m.cols - 1)}${m.row}"/>`).join("")}</mergeCells>`
    : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<dimension ref="A1:${last}${Math.max(1, lastRow)}"/>` +
    `<sheetViews><sheetView workbookViewId="0" rightToLeft="1" zoomScale="110">${freeze}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="20"/>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${rows}</sheetData>` +
    filter +
    mergeXml +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>` +
    `</worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>` +
  `<fonts count="5">` +
  `<font><sz val="11"/><color rgb="FF302725"/><name val="Arial"/><family val="2"/></font>` +
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>` +
  `<font><b/><sz val="16"/><color rgb="FFB62E30"/><name val="Arial"/><family val="2"/></font>` +
  `<font><b/><sz val="11"/><color rgb="FF302725"/><name val="Arial"/><family val="2"/></font>` +
  `<font><sz val="10"/><color rgb="FF6F645E"/><name val="Arial"/><family val="2"/></font>` +
  `</fonts>` +
  `<fills count="4">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFB62E30"/><bgColor indexed="64"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFF4EEE8"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="2">` +
  `<border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left style="thin"><color rgb="FFE6DDD5"/></left><right style="thin"><color rgb="FFE6DDD5"/></right><top style="thin"><color rgb="FFE6DDD5"/></top><bottom style="thin"><color rgb="FFE6DDD5"/></bottom><diagonal/></border>` +
  `</borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="13">` +
  // 0 body text
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>` +
  // 1 header
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>` +
  // 2 title
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>` +
  // 3 section
  `<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>` +
  // 4 meta label
  `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>` +
  // 5 meta value
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>` +
  // 6 number
  `<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
  // 7 hours (one decimal)
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
  // 8 percent
  `<xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
  // 9 total text
  `<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>` +
  // 10 total number
  `<xf numFmtId="3" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
  // 11 total hours
  `<xf numFmtId="164" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
  // 12 total percent
  `<xf numFmtId="9" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/* ---- zip (stored, no compression) ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[], when = new Date()) {
  const enc = new TextEncoder();
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, f.data.length, true);
    dir.setUint32(24, f.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const dirSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Excel sheet names: at most 31 characters, none of []:*?/\ */
const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";

/** Builds the .xlsx file for these sheets. */
export function buildXlsx(sheets: XSheet[], when = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const names = sheets.map((s) => sheetName(s.name));
  const defined = sheets
    .map((s, i) => {
      if (!s.filterRow || s.rows.length < s.filterRow) return "";
      const width = Math.max(s.widths.length, ...s.rows.map((r) => r.cells.length));
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i]!)}'!$A$${s.filterRow}:$${colName(width - 1)}$${s.rows.length}</definedName>`;
    })
    .join("");
  const files = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
          sheets
            .map(
              (_, i) =>
                `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            )
            .join("") +
          `</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<bookViews><workbookView activeTab="0"/></bookViews>` +
          `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
          (defined ? `<definedNames>${defined}</definedNames>` : "") +
          `</workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          sheets
            .map(
              (_, i) =>
                `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
            )
            .join("") +
          `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          `</Relationships>`,
      ),
    },
    { name: "xl/styles.xml", data: enc.encode(STYLES) },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: enc.encode(sheetXml(s)),
    })),
  ];
  return zip(files, when);
}
