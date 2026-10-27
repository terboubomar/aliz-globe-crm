import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { trackStatus } from "@/functions/public.functions";
import { StageTrack, fmt } from "@/components/crm";
import { alizLogo } from "@/lib/logos";

export const Route = createFileRoute("/track/$token")({
  head: () => ({ meta: [{ title: "متابعة الملاحظة" }, { name: "description", content: "حالة ملاحظتك" }, { property: "og:title", content: "متابعة الملاحظة" }, { property: "og:description", content: "حالة ملاحظتك" }, { name: "robots", content: "noindex" }] }),
  component: Track,
});

function Track() {
  const { token } = Route.useParams();
  const [d, setD] = useState<Awaited<ReturnType<typeof trackStatus>> | null>(null);
  useEffect(() => { trackStatus({ data: { token } }).then(setD).catch(() => setD({ ok: false, message: "رابط المتابعة غير صالح أو منتهي" })); }, [token]);
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <div className="space-y-4 rounded-xl border bg-card p-6 text-center">
        <img src={alizLogo} alt="أليز غلوب" className="mx-auto h-16 w-16 object-contain" />
        {!d && <p>…</p>}
        {d && !d.ok && <p className="font-bold">{d.message}</p>}
        {d?.ok && (
          <>
            <p className="text-2xl font-extrabold text-primary ltr">{d.number}</p>
            <p className="text-sm text-muted-foreground">{d.brand} · {d.branch} · {d.category}</p>
            <p className="text-sm">{fmt(d.receivedAt)}</p>
            <div className="flex justify-center"><StageTrack t={{ state: d.state }} /></div>
          </>
        )}
      </div>
    </main>
  );
}
