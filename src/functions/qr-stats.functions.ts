import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DomainError, authorize } from "@/lib/domain";
import type { QrStatsData } from "@/lib/qr-stats";

const core = () => import("./core.server");

/**
 * QR stats for a period (Riyadh days): visits to the QR forms, and the
 * complaints and suggestions sent from them, for the brands in the person's
 * scope. Also the all-time visit counters of the active codes.
 */
export const qrStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        brandId: z.string().max(100).optional(),
      })
      .refine(
        (v) => v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) / 86400000 < 366,
        "اختر فترة لا تتجاوز 366 يوماً.",
      )
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "report");
    const db = await c.admin();
    let brands = a.brandIds;
    if (a.role === "SUPER_ADMIN") {
      const { data: all } = await db.from("brands").select("id");
      brands = (all ?? []).map((b) => b.id as string);
    }
    if (data.brandId) brands = brands.filter((b) => b === data.brandId);
    if (!brands.length) throw new DomainError("FORBIDDEN", 403, "لا توجد علامات ضمن نطاقك");
    const start = new Date(data.from + "T00:00:00+03:00").toISOString();
    const end = new Date(Date.parse(data.to + "T00:00:00+03:00") + 86400000).toISOString();
    const [{ data: stats, error }, { data: codes }] = await Promise.all([
      db.rpc("qr_stats" as never, { _from: start, _to: end, _brands: brands } as never),
      db
        .from("qrs")
        .select("brand_id,branch_id,scans,active,branches(brand_id)")
        .eq("active", true),
    ]);
    if (error) throw new DomainError("LOAD_FAILED", 500, "تعذر تحميل إحصائيات QR");
    // All-time visits of the codes in use (counted before the dated log began too).
    const allTime: Record<string, number> = {};
    for (const q of codes ?? []) {
      const brand =
        (q.brand_id as string | null) ??
        ((q.branches as unknown as { brand_id: string } | null)?.brand_id ?? "");
      if (brands.includes(brand)) allTime[brand] = (allTime[brand] ?? 0) + (q.scans ?? 0);
    }
    return { ...(stats as unknown as QrStatsData), allTime };
  });
