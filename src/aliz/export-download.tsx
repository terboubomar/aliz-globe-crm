import { Download, FileSpreadsheet } from "lucide-react";
import { bookToCsv, bookToXlsx, type ExportBook } from "@/lib/report-export";

export type ExportFormat = "xlsx" | "csv";

/** Saves a report export as an Excel workbook or a CSV file. */
export function downloadBook(book: ExportBook, format: ExportFormat) {
  const blob =
    format === "xlsx"
      ? new Blob([bookToXlsx(book) as BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
      : new Blob([bookToCsv(book)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${book.fileName}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Excel" (main) and "CSV" export buttons for a report page. */
export function ExportButtons({
  busy,
  onExport,
}: {
  busy: ExportFormat | null;
  onExport: (format: ExportFormat) => void;
}) {
  return (
    <span className="export-buttons" role="group" aria-label="تصدير التقرير">
      <button
        type="button"
        className="secondary"
        disabled={busy !== null}
        onClick={() => onExport("xlsx")}
      >
        <FileSpreadsheet size={16} /> {busy === "xlsx" ? "جارٍ التصدير…" : "تصدير Excel"}
      </button>
      <button
        type="button"
        className="text-btn"
        disabled={busy !== null}
        title="ملف CSV بالتفاصيل فقط"
        onClick={() => onExport("csv")}
      >
        <Download size={15} /> {busy === "csv" ? "جارٍ التصدير…" : "CSV"}
      </button>
    </span>
  );
}
