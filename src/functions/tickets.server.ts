import { z } from "zod";
import {
  type Actor, DomainError, authorize, can, canWorkComplaint, inScope,
  isComplaintParticipant, normalizePhone, saudiMobile, slaMilestones, supportRoles, escalationRoles,
  ticketNumber, transition, briefHasPersonalData,
} from "@/lib/domain";
import { admin, catalog, rpcError, settings, type Ctx } from "./core.server";
import { decrypt, encrypt, keyedHash, randomToken, sha256 } from "./crypto.server";

export const ticketInput = z.object({
  brandId: z.string().min(1),
  branchId: z.string().uuid().nullable().optional(),
  unknownReason: z.string().max(300).optional(),
  category: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "اختر سبب الشكوى"),
  priority: z.enum(["P1", "P2", "P3"]),
  description: z.string().trim().min(10, "الوصف 10 أحرف على الأقل").max(4000),
  // When the reason is "Other": what the problem is, in a few words.
  otherDetail: z.string().trim().max(120).optional(),
  name: z.string().trim().max(100).optional(),
  phone: z.string().regex(saudiMobile, "أدخل رقم جوال سعودي صحيح").optional().or(z.literal("")),
  externalOrder: z.string().max(100).optional(),
  platform: z.string().trim().max(80).optional(),
  receivedAt: z.string().datetime().optional(),
  whatsappConsent: z.boolean().default(false),
  email: z.string().trim().toLowerCase().email("أدخل بريداً إلكترونياً صحيحاً").max(200).optional().or(z.literal("")),
  emailConsent: z.boolean().default(false),
});

export type Receipt = {
  number: string; brand: string; branch: string; receivedAt: string; category: string;
  description: string; customerName: string; externalOrder: string; platform: string;
  source: string; trackingPath: string;
};

export async function createTicketCore(
  actorId: string,
  raw: unknown,
  key: string,
  publicQr?: { brandId: string; branchId: string; qrId: string },
  actor?: Actor,
) {
  const body = ticketInput.parse(raw);
  if (!publicQr) {
    if (!actor) throw new DomainError("FORBIDDEN", 403, "غير مصرح");
    authorize(actor, "create", { brandId: body.brandId, branchId: body.branchId ?? null });
  }
  if (!key || key.length > 100) throw new DomainError("IDEMPOTENCY_REQUIRED", 400, "مفتاح الطلب مطلوب");
  const db = await admin();
  const brandId = publicQr?.brandId ?? body.brandId;
  const branchId = publicQr?.branchId ?? body.branchId ?? null;
  if (!branchId && !body.unknownReason?.trim())
    throw new DomainError("BRANCH_REQUIRED", 400, "حدد الفرع أو سبب عدم معرفته");
  const now = new Date();
  const received = body.receivedAt ? new Date(body.receivedAt) : now;
  if (+received > +now + 60000 || +received < +now - 30 * 86400000)
    throw new DomainError("INVALID_RECEIVED_TIME", 400, "وقت الاستقبال يجب أن يكون خلال آخر 30 يوماً");
  const phone = body.phone ? normalizePhone(body.phone) : "";
  if (body.whatsappConsent && !phone)
    throw new DomainError("PHONE_REQUIRED", 400, "أدخل رقم الجوال لاستلام تأكيد واتساب.");
  const email = body.email ?? "";
  if (body.emailConsent && !email)
    throw new DomainError("EMAIL_REQUIRED", 400, "أدخل البريد الإلكتروني لاستلام تأكيد الشكوى.");
  const [{ data: brand }, branchRow] = await Promise.all([
    db.from("brands").select("name,status").eq("id", brandId).maybeSingle(),
    branchId ? db.from("branches").select("name").eq("id", branchId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!brand) throw new DomainError("BRAND_INACTIVE", 400, "العلامة غير مفعلة");
  const s = await settings();
  const policy = s.sla;
  const lists = await catalog();
  const reason = lists.categories.find((c) => c.id === body.category && c.active);
  if (!reason) throw new DomainError("INVALID_CATEGORY", 400, "سبب الشكوى غير متاح؛ اختر سبباً من القائمة");
  const { asksDetail } = await import("@/lib/catalog");
  const detail = asksDetail(reason) ? (body.otherDetail ?? "").replace(/\s+/g, " ").trim() : "";
  if (asksDetail(reason) && detail.length < 3)
    throw new DomainError("DETAIL_REQUIRED", 400, "اكتب نوع المشكلة عند اختيار «أخرى»");
  const reasonLabel = detail ? `${reason.label}: ${detail}` : reason.label;
  const description = detail ? `نوع المشكلة: ${detail}\n\n${body.description}` : body.description;
  if (body.platform && !lists.platforms.some((p) => p.active && p.label === body.platform))
    throw new DomainError("INVALID_PLATFORM", 400, "منصة الطلب غير متاحة؛ اختر منصة من القائمة");
  // Urgent reasons (such as food safety) are always P1.
  const priority = reason.urgent ? "P1" : body.priority;
  const idemKey = `${actorId}:${key}`;
  const requestHash = await sha256(JSON.stringify(body));

  const { data: seq, error: seqErr } = await db.rpc("next_ticket_sequence");
  rpcError(seqErr);
  const number = ticketNumber(Number(seq), now);
  const access = publicQr || (body.whatsappConsent && phone) || (body.emailConsent && email) ? randomToken() : null;
  const receipt: Receipt = {
    number, brand: brand.name, branch: branchRow?.data?.name ?? "غير محدد",
    receivedAt: received.toISOString(), category: reasonLabel,
    description, customerName: body.name ?? "", externalOrder: body.externalOrder ?? "",
    platform: body.platform ?? "", source: publicQr ? "QR" : "الهاتف", trackingPath: access ? "/track/" + access : "",
  };
  const receiptEnc = await encrypt(JSON.stringify(receipt));
  const response = { number, trackingToken: access, receipt, confirmationStatus: "NOT_REQUESTED" as string };
  const { data, error } = await db.rpc("create_ticket_tx", {
    p: {
      idem_key: idemKey, request_hash: requestHash, sequence: seq, brand_id: brandId, branch_id: branchId,
      unknown_reason: branchId ? null : body.unknownReason, source: publicQr ? "PUBLIC_QR" : "PHONE_AGENT",
      category: body.category, priority, description_enc: await encrypt(description),
      receipt_enc: receiptEnc,
      customer_enc: body.name || phone || email ? await encrypt(JSON.stringify({ name: body.name ?? "", phone, ...(email ? { email } : {}) })) : null,
      phone_hash: phone ? await keyedHash("phone:" + phone) : null,
      external_order: body.externalOrder || null, platform: body.platform || null,
      communications_owner: publicQr ? "UNASSIGNED" : actorId, creator: publicQr ? "PUBLIC_QR" : actorId,
      received_at: received.toISOString(), sla_policy: policy, actor: actorId,
      event_type: publicQr ? "QR_CREATED" : "PHONE_CREATED",
      timers: slaMilestones(priority, received, policy),
      access_hash: access ? await keyedHash("track:" + access) : null,
      response_enc: await encrypt(JSON.stringify(response)),
    },
  });
  rpcError(error);
  const out = data as { replay: boolean; id?: string; response_enc?: string };
  if (out.replay) return JSON.parse(await decrypt(out.response_enc!)) as typeof response & { emailStatus?: string };
  const assignedTo = await (await import("./assign.server")).autoAssign(out.id!);
  const tg = await import("./telegram.server");
  if (assignedTo) await tg.notifyAssigned(out.id!, assignedTo);
  await tg.notifyNewComplaint(out.id!);
  const { queueAndSend } = await import("./receipts.server");
  const sent = await queueAndSend(out.id!, {
    whatsapp: body.whatsappConsent ? phone : undefined,
    email: body.emailConsent ? email : undefined,
  });
  return {
    ...response,
    id: out.id,
    confirmationStatus: sent.whatsapp ?? "NOT_REQUESTED",
    emailStatus: sent.email ?? "NOT_REQUESTED",
  };
}

type TicketRow = {
  id: string; sequence: number; brand_id: string; branch_id: string | null; unknown_reason: string | null;
  source: string; category: string; priority: string; state: string; description_enc: string;
  branch_brief_enc: string | null; customer_enc: string | null; external_order: string | null; platform: string | null;
  communications_owner: string; resolution_owner: string | null; creator: string; received_at: string;
  created_at: string; acknowledged_at: string | null; action_completed_at: string | null;
  customer_confirmed_at: string | null; closed_at: string | null; version: number; escalated: boolean;
};

export async function presentTicket(t: TicketRow, a: Actor, detail = false) {
  const pii = can(a, "pii");
  const base = {
    id: t.id, number: ticketNumber(t.sequence, t.created_at), brandId: t.brand_id, branchId: t.branch_id,
    unknownReason: t.unknown_reason, source: t.source, category: t.category, priority: t.priority, state: t.state,
    externalOrder: t.external_order, platform: t.platform, communicationsOwner: t.communications_owner,
    resolutionOwner: t.resolution_owner, creator: t.creator, receivedAt: t.received_at, createdAt: t.created_at,
    acknowledgedAt: t.acknowledged_at, actionCompletedAt: t.action_completed_at,
    customerConfirmedAt: t.customer_confirmed_at, closedAt: t.closed_at, version: t.version, escalated: t.escalated,
  };
  if (!detail) return { ...base, description: null as string | null, customer: null as { name: string; phone: string; email?: string } | null, branchBrief: null as string | null };
  return {
    ...base,
    description: pii ? await decrypt(t.description_enc) : "تفاصيل العميل محجوبة حسب الصلاحية",
    customer: pii && t.customer_enc ? (JSON.parse(await decrypt(t.customer_enc)) as { name: string; phone: string; email?: string }) : null,
    branchBrief: t.branch_brief_enc ? await decrypt(t.branch_brief_enc) : null,
  };
}

const actionInput = z.object({
  version: z.number().int(),
  note: z.string().trim().min(3, "أضف ملاحظة من 3 أحرف على الأقل").max(2000),
  resolutionOwner: z.string().optional(),
  outcome: z.enum(["SATISFIED", "UNREACHABLE", "UNRESOLVED"]).optional(),
  branchBrief: z.string().trim().min(10).max(1000).optional(),
});
const permFor: Record<string, string> = {
  reopen: "close", comment: "comment", contact: "contact", assign: "assign", close: "close",
  start: "investigate", followup: "contact", resolve: "resolve", escalate: "escalate",
};

export async function ticketActionCore(ctx: Ctx, a: Actor, id: string, action: string, raw: unknown) {
  const b = actionInput.parse(raw);
  const { data: t } = await ctx.supabase.from("tickets").select("*").eq("id", id).maybeSingle();
  if (!t) throw new DomainError("NOT_FOUND", 404, "البلاغ غير موجود ضمن نطاقك");
  const scope = { brandId: t.brand_id, branchId: t.branch_id };
  authorize(a, permFor[action] ?? "__deny", scope);
  const view = { creator: t.creator, resolutionOwner: t.resolution_owner, communicationsOwner: t.communications_owner };
  if (a.role === "AGENT" && action === "comment" && !isComplaintParticipant(a, view))
    throw new DomainError("OWNER_REQUIRED", 403, "يمكنك عرض الشكوى؛ إضافة الملاحظات متاحة للموظف المسند أو مسجل الشكوى");
  if (["contact", "followup"].includes(action) && a.role === "AGENT" && t.communications_owner !== a.id)
    throw new DomainError("OWNER_REQUIRED", 403, "إجراء التواصل وتأكيد العميل متاح لمسؤول التواصل المسند أو المشرف");
  if (["start", "resolve", "escalate"].includes(action) && !canWorkComplaint(a, { ...scope, resolutionOwner: t.resolution_owner, escalated: t.escalated }))
    throw new DomainError("OWNER_REQUIRED", 403, "الإجراء متاح للمسؤول المسند أو المشرف ضمن نطاقه");
  if (b.version !== t.version) throw new DomainError("CONFLICT", 409, "تم تحديث البلاغ؛ حدّث الصفحة وأعد المحاولة");

  const db = await admin();
  const { data: refunds } = await db.from("refunds").select("status").eq("ticket_id", id);
  const openRefund = (refunds ?? []).some((r) => !["COMPLETED", "REJECTED"].includes(r.status));
  const { data: events } = await db.from("ticket_events").select("type,created_at").eq("ticket_id", id);
  const contactedAfterAction = !!t.action_completed_at && (events ?? []).some((e) => e.type === "CONTACT_RECORDED" && e.created_at >= t.action_completed_at!);

  const next = ["comment", "contact", "escalate", "followup"].includes(action) ? t.state : transition(t.state, action);
  if (action === "close" && (!t.action_completed_at || !t.customer_confirmed_at || !contactedAfterAction || openRefund))
    throw new DomainError("CLOSURE_BLOCKED", 409, "إغلاق البلاغ يتطلب معالجة موثقة، وتواصلاً وتأكيد العميل، واكتمال الطلبات المالية المرتبطة");

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { state: next };
  const evts: { type: string; note_enc?: string | null }[] = [];
  const timers: Record<string, unknown>[] = [];
  const noteEnc = await encrypt(b.note);

  if (b.branchBrief && ["assign", "escalate", "followup"].includes(action)) {
    const known = t.customer_enc ? (JSON.parse(await decrypt(t.customer_enc)).name as string) : "";
    if (briefHasPersonalData(b.branchBrief, known))
      throw new DomainError("PERSONAL_DATA_IN_BRIEF", 400, "أزل الأسماء وأرقام الاتصال والبريد من موجز التصعيد؛ استخدم الحقول المخصصة");
    patch["branch_brief_enc"] = await encrypt(b.branchBrief);
  }
  if (action === "assign") {
    const ownerId = b.resolutionOwner;
    if (!ownerId) throw new DomainError("OWNER_REQUIRED", 400, "اختر مسؤولاً واحداً من فريق خدمة العملاء");
    const { data: o } = await db.from("user_roles").select("*").eq("user_id", ownerId).maybeSingle();
    const owner = o && { id: o.user_id, name: o.name, role: o.role, brandIds: o.brand_ids, branchIds: o.branch_ids };
    if (!o?.enabled || !owner || !supportRoles.includes(owner.role) || !inScope(owner, scope))
      throw new DomainError("INVALID_OWNER", 400, "اختر موظف دعم ضمن نطاق العلامة والفرع");
    Object.assign(patch, { resolution_owner: owner.id, communications_owner: owner.id, escalated: false, acknowledged_at: null });
  }
  if (action === "start") patch["acknowledged_at"] = t.acknowledged_at ?? now;
  if (action === "resolve") patch["action_completed_at"] = now;
  if (action === "close") patch["closed_at"] = now;
  if (action === "reopen") Object.assign(patch, { closed_at: null, action_completed_at: null, customer_confirmed_at: null });
  if (action === "followup") {
    if (t.state !== "RESOLVED" || !t.action_completed_at || !b.outcome)
      throw new DomainError("FOLLOWUP_BLOCKED", 409, "وثّق الحل ثم حدد نتيجة التواصل مع العميل");
    if (b.outcome === "SATISFIED") {
      patch["customer_confirmed_at"] = now;
      if (!openRefund) Object.assign(patch, { state: "CLOSED", closed_at: now });
    }
  }
  const escalating = action === "escalate" || (action === "followup" && b.outcome === "UNRESOLVED");
  if (escalating) {
    if (t.state === "CLOSED") throw new DomainError("ESCALATION_BLOCKED", 409, "أعد فتح الشكوى قبل التصعيد");
    const { data: tr } = b.resolutionOwner ? await db.from("user_roles").select("*").eq("user_id", b.resolutionOwner).maybeSingle() : { data: null };
    const target = tr && { id: tr.user_id, name: tr.name, role: tr.role, brandIds: tr.brand_ids, branchIds: tr.branch_ids };
    if (!tr?.enabled || !target || target.id === a.id || !inScope(target, scope) || !escalationRoles.includes(target.role))
      throw new DomainError("INVALID_ESCALATION_OWNER", 400, "اختر مشرف دعم أو مدير منطقة أو عمليات ضمن نطاق العلامة والفرع");
    if (!b.branchBrief && !t.branch_brief_enc)
      throw new DomainError("ESCALATION_BRIEF_REQUIRED", 400, "أضف موجز التصعيد دون بيانات العميل الشخصية");
    Object.assign(patch, { resolution_owner: target.id, escalated: true, state: "ASSIGNED", acknowledged_at: null, action_completed_at: null, customer_confirmed_at: null, closed_at: null });
  }
  evts.push({ type: action === "followup" || action === "contact" ? "CONTACT_RECORDED" : action.toUpperCase(), note_enc: noteEnc });
  if (action === "followup") {
    evts.push({ type: `FOLLOWUP_${b.outcome}`, note_enc: noteEnc });
    if (b.outcome === "SATISFIED") evts.push({ type: "CUSTOMER_CONFIRMED" });
    if (patch["state"] === "CLOSED") evts.push({ type: "CLOSE" });
  }
  if (escalating) evts.push({ type: "ESCALATION_ROUTED" });
  if (!["comment", "escalate"].includes(action)) timers.push({ op: "complete", milestone: "FIRST_ACTION" });
  if (action === "assign" || escalating) {
    const pol = (t.sla_policy as never) ?? (await settings()).sla;
    const ack = slaMilestones(t.priority, new Date(t.received_at), pol, new Date()).find((m) => m.milestone === "ACKNOWLEDGMENT")!;
    timers.push({ op: "upsert", ...ack });
  }
  if (action === "start") timers.push({ op: "complete", milestone: "ACKNOWLEDGMENT" });
  if (escalating) timers.push({ op: "reopen", milestone: "REMEDY" });
  if (action === "resolve") timers.push({ op: "complete", milestone: "REMEDY" });

  const { error } = await db.rpc("apply_ticket_action", {
    _id: id, _version: b.version, p: patch as never, _events: evts as never, _timers: timers as never, _actor: a.id,
  });
  rpcError(error);
  const newOwner = patch["resolution_owner"];
  if (typeof newOwner === "string" && newOwner !== t.resolution_owner)
    await (await import("./telegram.server")).notifyAssigned(id, newOwner);
  return { ok: true };
}
