import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DomainError, assertRefundSeparation, authorize, can, normalizePhone, refundNext, refundNumber, refundPermission, saudiMobile,
} from "@/lib/domain";
import { REFUND_PLATFORMS, methodsForPlatform, normalizeIban, validIban, type RefundDestination } from "@/lib/refund-request";

const core = () => import("./core.server");

export const listRefunds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await core();
    const { decrypt } = await import("./crypto.server");
    const a = await c.requireActor(context as never);
    if (!can(a, "read") && !can(a, "refund.view")) return [];
    // RLS (refund_visible) applies the source refundScope: brand/branch, agent-own, ops-escalated.
    const { data, error } = await context.supabase.from("refunds").select("*, refund_events(*)").order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    const pii = can(a, "pii");
    // Refund handlers (IT manager) need the request details and where to send the money.
    const details = pii || can(a, "refund.view");
    const db = await c.admin();
    const ids = (data ?? []).map((r) => r.id);
    const { data: dests } = ids.length
      ? await db.from("outbox").select("ticket_id,status").in("key", ids.map((id) => "refunddest:" + id))
      : { data: [] as { ticket_id: string; status: string }[] };
    const destinationOf = async (r: { id: string; requester: string }) => {
      const row = dests?.find((d) => d.ticket_id === r.id);
      if (!row || !(details || r.requester === a.id)) return null;
      try {
        return JSON.parse(await decrypt(row.status)) as RefundDestination;
      } catch {
        return null;
      }
    };
    return Promise.all(
      (data ?? []).map(async (r) => ({
        id: r.id, number: refundNumber(r.sequence, r.created_at), ticketId: r.ticket_id, brandId: r.brand_id,
        branchId: r.branch_id, externalOrder: r.external_order, platform: r.platform, kind: r.kind,
        amountMinor: r.amount_minor, status: r.status, requester: r.requester, approver: r.approver,
        processor: r.processor, verifier: r.verifier, externalReference: r.external_reference,
        createdAt: r.created_at, version: r.version,
        reason: details || r.requester === a.id ? await decrypt(r.reason_enc) : "تفاصيل الطلب مقيدة حسب الصلاحية",
        destination: await destinationOf(r),
        events: await Promise.all(
          ((r.refund_events as { id: string; type: string; actor: string; note_enc: string | null; created_at: string }[]) ?? [])
            .sort((x, y) => x.created_at.localeCompare(y.created_at))
            .map(async (e) => ({ id: e.id, type: e.type, actor: e.actor, createdAt: e.created_at, note: e.note_enc && (details || e.actor === a.id) ? await decrypt(e.note_enc) : null })),
        ),
      })),
    );
  });

const destinationInput = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("BANK"),
    holder: z.string().trim().min(3, "اكتب اسم صاحب الحساب كما في البنك").max(100),
    iban: z.string().transform(normalizeIban).refine(validIban, "رقم الآيبان غير صحيح؛ يبدأ بـ SA ويتكون من 24 خانة"),
  }),
  z.object({
    method: z.literal("WALLET"),
    phone: z.string().trim().regex(saudiMobile, "أدخل رقم جوال سعودي صحيح للمحفظة").transform(normalizePhone),
  }),
]);
// New requests: refunds only, one of the refund platforms, an amount, and where the money goes.
const requestInput = z.object({
  brandId: z.string().min(1, "اختر العلامة"),
  branchId: z.string().uuid("اختر الفرع"),
  externalOrder: z.string().trim().min(1, "أدخل رقم الطلب").max(100),
  platform: z.enum(REFUND_PLATFORMS, { message: "اختر منصة الطلب" }),
  reason: z.string().trim().min(5, "السبب 5 أحرف على الأقل").max(1000),
  amountMinor: z.number({ message: "أدخل المبلغ المطلوب" }).int().positive("أدخل المبلغ المطلوب").max(10000000),
  destination: destinationInput,
}).refine((b) => methodsForPlatform(b.platform).includes(b.destination.method), {
  message: "طريقة الاسترجاع غير متاحة لهذه المنصة",
  path: ["destination"],
});

export const requestRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => requestInput.parse(d))
  .handler(async ({ data: b, context }) => {
    const c = await core();
    const { encrypt } = await import("./crypto.server");
    const a = await c.requireActor(context as never);
    authorize(a, "refund.request");
    const { brandId, branchId, externalOrder, platform } = b;
    authorize(a, "refund.request", { brandId, branchId });
    const db = await c.admin();
    const { data: brand } = await db.from("brands").select("status").eq("id", brandId).maybeSingle();
    if (!brand || brand.status !== "ACTIVE") throw new DomainError("BRAND_INACTIVE", 400, "العلامة غير مفعلة");
    const { data: id, error } = await db.rpc("request_refund_tx", {
      p: { ticket_id: null, brand_id: brandId, branch_id: branchId, external_order: externalOrder, platform, kind: "REFUND", reason_enc: await encrypt(b.reason), amount_minor: b.amountMinor, requester: a.id },
    });
    c.rpcError(error);
    // Where the money goes back to, encrypted, next to the refund.
    const { error: destError } = await db.from("outbox").upsert(
      { key: "refunddest:" + id, type: "REFUND_DESTINATION", ticket_id: String(id), status: await encrypt(JSON.stringify(b.destination)) },
      { onConflict: "key" },
    );
    c.rpcError(destError);
    await (await import("./telegram.server")).notifyRefundRequested(String(id));
    return { id };
  });

const actionInput = z.object({
  id: z.string().uuid(),
  action: z.enum(["review", "approve", "reject", "execute", "verify", "notify", "complete", "resubmit"]),
  version: z.number().int(),
  note: z.string().trim().min(3, "أضف ملاحظة").max(1000),
  reference: z.string().trim().max(200).optional(),
  proofId: z.string().uuid().optional(),
  reason: z.string().trim().min(5).max(1000).optional(),
  amountMinor: z.number().int().positive().max(10000000).optional(),
});

export const refundAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => actionInput.parse(d))
  .handler(async ({ data: b, context }) => {
    const c = await core();
    const { encrypt } = await import("./crypto.server");
    const a = await c.requireActor(context as never);
    const { data: r } = await context.supabase.from("refunds").select("*").eq("id", b.id).maybeSingle();
    if (!r) throw new DomainError("NOT_FOUND", 404, "الطلب المالي غير موجود ضمن نطاقك");
    authorize(a, refundPermission(b.action), { brandId: r.brand_id, branchId: r.branch_id });
    assertRefundSeparation(a, r, b.action);
    if (b.version !== r.version) throw new DomainError("CONFLICT", 409, "تم تعديل الطلب؛ حدّث الصفحة");
    const s = await c.settings();
    // Financial activation stays off until the owner approves the finance policy and limit.
    if (!s.financeApproved) throw new DomainError("POLICY_PENDING", 409, "السياسة المالية بانتظار الاعتماد");
    if (b.action === "approve") {
      const limit = s.financeLimitMinor;
      if (!limit || limit <= 0 || (r.kind === "REFUND" && !r.amount_minor))
        throw new DomainError("POLICY_PENDING", 409, "حد الموافقة والمبلغ المتحقق منه مطلوبان");
      if (r.amount_minor && r.amount_minor > limit) throw new DomainError("LIMIT_EXCEEDED", 403, "المبلغ يتجاوز حد الموافقة");
    }
    const db = await c.admin();
    if (b.action === "execute") {
      const owners = [`refund_id.eq.${r.id}`, ...(r.ticket_id ? [`ticket_id.eq.${r.ticket_id}`] : [])];
      const { data: f } = await db.from("attachments").select("id").eq("id", b.proofId ?? "00000000-0000-0000-0000-000000000000").eq("status", "CLEAN").or(owners.join(",")).maybeSingle();
      if (!b.reference || !f) throw new DomainError("PROOF_REQUIRED", 400, "مرجع التنفيذ وإثبات نظيف يخص الطلب مطلوبان");
    }
    const status = refundNext(r.status, b.action);
    const patch: Record<string, unknown> = { status };
    if (["approve", "reject"].includes(b.action)) patch["approver"] = a.id;
    if (b.action === "execute") Object.assign(patch, { processor: a.id, external_reference: b.reference, proof_id: b.proofId });
    if (b.action === "verify") patch["verifier"] = a.id;
    if (b.action === "resubmit") {
      Object.assign(patch, { approver: null, processor: null, verifier: null, external_reference: null, proof_id: null });
      if (b.reason) patch["reason_enc"] = await encrypt(b.reason);
      if (b.amountMinor !== undefined) patch["amount_minor"] = b.amountMinor;
    }
    const { error } = await db.rpc("apply_refund_action", {
      _id: r.id, _version: b.version, p: patch as never, _type: b.action.toUpperCase(), _note_enc: await encrypt(b.note), _actor: a.id,
    });
    c.rpcError(error);
    return { ok: true };
  });
