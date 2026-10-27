import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/app-data";
import { searchComplaints } from "@/server/complaints.functions";
import { PageHead, PriorityChip, StateChip, fmt, BrandLogo } from "@/components/crm";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "لوحة المتابعة — أليز غلوب" }, { name: "description", content: "ملخص الشكاوى ضمن نطاقك" }, { property: "og:title", content: "لوحة المتابعة" }, { property: "og:description", content: "ملخص الشكاوى ضمن نطاقك" }] }),
  component: Dashboard,
});

function useCount(filter: string) {
  return useQuery({ queryKey: ["count", filter], queryFn: () => searchComplaints({ data: { filter: filter as never, q: "", offset: 0 } }) });
}

function Dashboard() {
  const app = useApp();
  const open = useCount("open"), waiting = useCount("waiting"), esc = useCount("escalated"), contact = useCount("contact");
  const inactive = app.brands.filter((b) => b.status !== "ACTIVE");
  return (
    <>
      <PageHead title="لوحة المتابعة" />
      {inactive.length > 0 && (
        <div className="panel mb-4 border-warning text-sm"><b>تنبيه:</b> {inactive.length} من العلامات غير مفعلة بعد؛ لا تُقبل شكاوى جديدة لها حتى يفعّلها مدير النظام.</div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["مفتوحة", open], ["بانتظار الإسناد", waiting], ["مصعّدة", esc], ["بانتظار التواصل", contact]].map(([l, q]) => (
          <div key={l as string} className="panel">
            <div className="text-xs font-bold text-muted-foreground">{l as string}</div>
            <div className="mt-1 text-3xl font-extrabold text-ink">{(q as ReturnType<typeof useCount>).data?.total ?? "…"}</div>
          </div>
        ))}
      </div>
      <section className="panel mt-4 overflow-x-auto">
        <h2 className="mb-2 font-bold">بانتظار الإسناد</h2>
        {waiting.data?.tickets.length === 0 && <p className="text-muted-foreground">لا توجد شكاوى بانتظار الإسناد.</p>}
        <table className="table">
          <tbody>
            {waiting.data?.tickets.slice(0, 10).map((t) => (
              <tr key={t.id}>
                <td><Link className="font-bold text-primary ltr" to="/complaints/$id" params={{ id: t.id }}>{t.number}</Link></td>
                <td><span className="flex items-center gap-2"><BrandLogo id={t.brandId} size={22} />{app.brandName(t.brandId)}</span></td>
                <td>{app.branchName(t.branchId)}</td>
                <td><PriorityChip p={t.priority} /></td>
                <td><StateChip state={t.state} /></td>
                <td className="text-muted-foreground">{fmt(t.receivedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
