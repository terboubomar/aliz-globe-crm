import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DomainError, authorize, can, inScope, type Actor, hasFullAccess } from "@/lib/domain";

/* Google ratings and latest reviews per branch (read-only, Places API). */
const core = () => import("./core.server");
const places = () => import("./places.server");

const mayView = (a: Actor) => hasFullAccess(a.role) || can(a, "contact") || can(a, "configure");

async function branchRow(id: string) {
  const db = await (await core()).admin();
  const { data } = await db
    .from("branches")
    .select("id,brand_id,google_place_id")
    .eq("id", id)
    .maybeSingle();
  const row = data as { id: string; brand_id: string; google_place_id: string | null } | null;
  if (!row) throw new DomainError("NOT_FOUND", 404, "الفرع غير موجود");
  return row;
}
const fail = (e: unknown): never => {
  if (e instanceof DomainError) throw e;
  throw new DomainError("GOOGLE_PLACES", 502, (e as Error)?.message || "تعذر الاتصال بـ Google");
};

/** Whether the key is set, and which visible branches are linked to a Google place. */
export const placesStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    if (!mayView(a)) throw new DomainError("FORBIDDEN", 403, "غير مصرح");
    const db = await c.admin();
    const { data } = await db
      .from("branches")
      .select("id,brand_id,google_place_id")
      .not("google_place_id" as never, "is", null);
    const rows = (data ?? []) as unknown as {
      id: string;
      brand_id: string;
      google_place_id: string;
    }[];
    return {
      configured: (await places()).placesConfigured(),
      links: rows
        .filter((r) => inScope(a, { brandId: r.brand_id, branchId: r.id }))
        .map((r) => ({ branchId: r.id, placeId: r.google_place_id })),
    };
  });

export const placesSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ branchId: z.string(), query: z.string().trim().min(2).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    const b = await branchRow(data.branchId);
    authorize(a, "branches.manage", { brandId: b.brand_id, branchId: b.id });
    const p = await places();
    if (!p.placesConfigured())
      throw new DomainError("NOT_CONFIGURED", 409, "أضف GOOGLE_PLACES_API_KEY أولاً");
    return p.searchPlaces(data.query).catch(fail);
  });

export const placesLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        branchId: z.string(),
        placeId: z
          .string()
          .regex(/^[\w-]{10,300}$/)
          .nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    const b = await branchRow(data.branchId);
    authorize(a, "branches.manage", { brandId: b.brand_id, branchId: b.id });
    await (await places()).linkPlace(b.id, data.placeId).catch(fail);
    const db = await c.admin();
    await db.rpc("write_audit", {
      _actor: a.id,
      _action: data.placeId ? "BRANCH_GOOGLE_PLACE_LINKED" : "BRANCH_GOOGLE_PLACE_UNLINKED",
      _entity: b.id,
    });
    return { ok: true };
  });

/** One branch's Google rating and latest reviews, live from Google. */
export const placesBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ branchId: z.string(), fresh: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    if (!mayView(a)) throw new DomainError("FORBIDDEN", 403, "غير مصرح");
    const b = await branchRow(data.branchId);
    if (!inScope(a, { brandId: b.brand_id, branchId: b.id }))
      throw new DomainError("FORBIDDEN", 403, "خارج نطاقك");
    if (!b.google_place_id)
      throw new DomainError("NOT_LINKED", 409, "الفرع غير مربوط بمكانه في خرائط Google");
    const p = await places();
    if (!p.placesConfigured())
      throw new DomainError("NOT_CONFIGURED", 409, "أضف GOOGLE_PLACES_API_KEY أولاً");
    return p.branchPlace(b.id, b.google_place_id, { fresh: !!data.fresh }).catch(fail);
  });
