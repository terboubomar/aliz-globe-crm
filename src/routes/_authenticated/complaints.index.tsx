import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { Search } from "lucide-react";
import { useApp } from "@/lib/app-data";
import { searchComplaints } from "@/server/complaints.functions";
import { categoryLabels, complaintStage, complaintStages } from "@/lib/domain";
import { BrandLogo, PageHead, PriorityChip, fmt } from "@/components/crm";

const filters = { all: "الكل", open: "المفتوحة", waiting: "بانتظار الإسناد", working: "جارٍ العمل", contact: "التواصل مع العميل", escalated: "المصعّدة", closed: "تم الحل", mine: "المرتبطة بي" } as const;

export const Route = createFileRoute("/_authenticated/complaints/")({
  validateSearch: z.object({ filter: z.enum(Object.keys(filters) as [keyof typeof filters]).optional() }),
  head: () => ({ meta: [{ title: "الشكاوى — أليز غلوب" }, { name: "description", content: "البحث في الشكاوى ضمن نطاقك" }, { property: "og:title", content: "الشكاوى" }, { property: "og:description", content: "البحث في الشكاوى ضمن نطاقك" }] }),
  component: List,
});

function List() {
  const app = useApp();
  const search = Route.useSearch();
  const [filter, setFilter] = useState<keyof typeof filters>(search.filter ?? "open");
  const [brandId, setBrand] = useState("all");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [offset, setOffset] = useState(0);
  const { data, isLoading, error } = useQuery({
    queryKey: ["search", filter, brandId, term, offset],
    queryFn: () => searchComplaints({ data: { filter, brandId, q: term, offset } }),
  });
  return (
    <>
      <PageHead title="الشكاوى">{app.has("create") && <Link to="/complaints/new" className="btn-primary">تسجيل شكوى هاتفية</Link>}</PageHead>
      <form className="panel mb-3 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setOffset(0); setTerm(q); }}>
        <label className="field min-w-64 flex-1">بحث برقم الشكوى أو الطلب أو الفرع{app.has("pii") ? " أو الجوال" : ""}
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="AG-2026-000001" />
        </label>
        <label className="field">العلامة
          <select className="input" value={brandId} onChange={(e) => { setBrand(e.target.value); setOffset(0); }}>
            <option value="all">كل العلامات المسموحة</option>
            {app.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <button className="btn-primary"><Search size={18} /> بحث</button>
      </form>
      <div className="mb-3 flex flex-wrap gap-2" role="tablist">
        {(Object.keys(filters) as (keyof typeof filters)[]).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "btn-primary min-h-9 px-3" : "btn-ghost min-h-9 px-3"} onClick={() => { setFilter(f); setOffset(0); }}>{filters[f]}</button>
        ))}
      </div>
      <div className="panel overflow-x-auto p-0">
        {isLoading && <p className="p-4 text-muted-foreground">جارٍ البحث…</p>}
        {error && <p className="error-text p-4">{(error as Error).message}</p>}
        {data && data.tickets.length === 0 && <p className="p-4 text-muted-foreground">لا توجد نتائج ضمن نطاقك.</p>}
        {data && data.tickets.length > 0 && (
          <table className="table">
            <thead><tr><th>الرقم</th><th>العلامة</th><th>الفرع</th><th>التصنيف</th><th>الأولوية</th><th>المرحلة</th><th>المسؤول</th><th>وقت الاستقبال</th></tr></thead>
            <tbody>
              {data.tickets.map((t) => (
                <tr key={t.id}>
                  <td><Link className="font-bold text-primary ltr" to="/complaints/$id" params={{ id: t.id }}>{t.number}</Link></td>
                  <td><span className="flex items-center gap-2"><BrandLogo id={t.brandId} size={22} />{app.brandName(t.brandId)}</span></td>
                  <td>{app.branchName(t.branchId)}</td>
                  <td>{categoryLabels[t.category]}</td>
                  <td><PriorityChip p={t.priority} /></td>
                  <td>{complaintStages.find((s) => s.id === complaintStage(t))?.label}{t.escalated && <span className="chip-crit mr-1">مصعّدة</span>}</td>
                  <td>{app.staffName(t.resolutionOwner)}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{fmt(t.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <span>الإجمالي: {data.total}</span>
          {offset > 0 && <button className="btn-ghost" onClick={() => setOffset(Math.max(0, offset - 50))}>السابق</button>}
          {data.nextOffset != null && <button className="btn-ghost" onClick={() => setOffset(data.nextOffset!)}>التالي</button>}
        </div>
      )}
    </>
  );
}
