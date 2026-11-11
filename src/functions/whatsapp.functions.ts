import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DomainError, authorize, can } from "@/lib/domain";

/*
 * WhatsApp through Bevatel: Settings (status, test send, confirm the test arrived)
 * and the per-complaint log with a manual resend. Sending runs on the server only.
 */
const core = () => import("./core.server");
const wa = () => import("./whatsapp.server");
const template = z.enum(["received", "resolved", "closed"]);

async function superAdmin(context: unknown) {
  const c = await core();
  const a = await c.requireActor(context as never);
  if (a.role !== "SUPER_ADMIN") throw new DomainError("FORBIDDEN", 403, "متاح لمدير النظام فقط");
  return { c, a };
}
const canResend = (a: { role: string; financeDuty?: string }) =>
  a.role === "SUPER_ADMIN" || can(a as never, "configure");

export const whatsappStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await superAdmin(context);
    const w = await wa();
    return {
      configured: w.bevatelConfigured(),
      format: await w.savedFormat(),
      ...(await w.statusSummary()),
    };
  });

export const whatsappSendTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        phone: z.string().trim().min(9).max(20),
        template,
        format: z.enum(["flat", "body"]).default("flat"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { c, a } = await superAdmin(context);
    const result = await (await wa()).sendTest(data.phone, data.template, a.id, fetch, data.format);
    const db = await c.admin();
    await db.rpc("write_audit", {
      _actor: a.id,
      _action: `WHATSAPP_TEST_${result.status.toUpperCase()}`,
      _entity: data.template,
    });
    // The raw reply is shown so the admin can see exactly what Bevatel answered.
    return {
      ...result,
      response: result.response === null ? null : JSON.stringify(result.response, null, 2),
    };
  });

export const whatsappConfirmTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { c, a } = await superAdmin(context);
    const ok = await (await wa()).confirmTest(data.id);
    if (!ok) throw new DomainError("NOT_FOUND", 404, "لا توجد رسالة تجريبية مرسلة بهذا الرقم");
    const db = await c.admin();
    await db.rpc("write_audit", {
      _actor: a.id,
      _action: "WHATSAPP_TEST_CONFIRMED",
      _entity: data.id,
    });
    return { ok: true };
  });

/** The complaint must be visible to this user (row-level security decides). */
async function visibleComplaint(context: { supabase: unknown }, id: string) {
  const supabase = context.supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> };
      };
    };
  };
  const { data } = await supabase.from("tickets").select("id").eq("id", id).maybeSingle();
  if (!data) throw new DomainError("NOT_FOUND", 404, "الشكوى غير موجودة");
}

export const whatsappLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "read");
    await visibleComplaint(context as never, data.id);
    const rows = await (await wa()).complaintLog(data.id);
    const admin = a.role === "SUPER_ADMIN";
    return {
      canResend: canResend(a),
      rows: rows.map((r) => ({ ...r, response: admin ? r.response : null })),
    };
  });

export const whatsappResend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), template }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    if (!canResend(a)) throw new DomainError("FORBIDDEN", 403, "إعادة الإرسال للمشرفين فقط");
    await visibleComplaint(context as never, data.id);
    const r = await (
      await wa()
    ).sendForComplaint(data.id, data.template, { actor: a.id, manual: true });
    const db = await c.admin();
    await db.rpc("write_audit", {
      _actor: a.id,
      _action: `WHATSAPP_RESEND_${r.status.toUpperCase()}`,
      _entity: data.id,
    });
    return { status: r.status, error: r.error ?? null };
  });

/** What Bevatel/WhatsApp finally did with a test message (sent, delivered, read or failed). */
export const whatsappCheckDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await superAdmin(context);
    return (await wa()).deliveryStatus(data.id);
  });

/** Inbox type and the last messages of the test conversation, for comparing with Bevatel's own sends. */
export const whatsappDiagnose = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await superAdmin(context);
    return { report: await (await wa()).diagnose(data.id) };
  });
