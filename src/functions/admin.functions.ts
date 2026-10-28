import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DomainError, assignableRoles, authorize, can, financeDuties, inScope, overlaps, safeCell, stateLabels, ticketNumber,
  categoryLabels,
} from "@/lib/domain";

const core = () => import("./core.server");

/* ---------------- Directory: brands & pickup-only branches ---------------- */
export const updateBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string(), name: z.string().trim().min(2).max(80).optional(), status: z.enum(["DRAFT", "ACTIVE", "SUSPENDED"]).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    if (data.status) authorize(a, "directory.activate");
    if (data.name) authorize(a, "brands.manage", { brandId: data.id });
    const db = await c.admin();
    const { error } = await db.from("brands").update({ ...(data.name ? { name: data.name } : {}), ...(data.status ? { status: data.status } : {}) }).eq("id", data.id);
    c.rpcError(error);
    await db.rpc("write_audit", { _actor: a.id, _action: data.status ? `BRAND_${data.status}` : "BRAND_UPDATED", _entity: data.id });
    return { ok: true };
  });

const branchFields = z.object({
  brandId: z.string(),
  name: z.string().trim().min(2).max(100),
  code: z.string().regex(/^[A-Z0-9_-]{2,30}$/, "الرمز بأحرف إنجليزية كبيرة وأرقام"),
  city: z.string().trim().min(2).max(80),
  district: z.string().trim().max(80).optional().nullable(),
  address: z.string().trim().max(200).optional().nullable(),
  mapsUrl: z.string().trim().url().max(500).optional().nullable().or(z.literal("")),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
}).refine((v) => (v.latitude == null) === (v.longitude == null), { message: "أدخل خط العرض وخط الطول معاً" });

export const saveBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid().optional(), fields: branchFields }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    const f = data.fields;
    authorize(a, "branches.manage", { brandId: f.brandId, branchId: data.id ?? null });
    if (!data.id && a.branchIds.length) throw new DomainError("FORBIDDEN", 403, "إنشاء الفروع يتطلب نطاق علامة كامل");
    const db = await c.admin();
    const row = {
      brand_id: f.brandId, name: f.name, code: f.code, city: f.city, district: f.district || null, address: f.address || null,
      maps_url: f.mapsUrl || null, latitude: f.latitude ?? null, longitude: f.longitude ?? null, phone: f.phone || null,
    };
    if (data.id) {
      const { data: cur } = await db.from("branches").select("brand_id").eq("id", data.id).maybeSingle();
      if (!cur || !inScope(a, { brandId: cur.brand_id, branchId: data.id })) throw new DomainError("NOT_FOUND", 404, "الفرع غير متاح");
      const { count } = await db.from("tickets").select("id", { count: "exact", head: true }).eq("branch_id", data.id);
      if (cur.brand_id !== f.brandId && (count ?? 0) > 0) throw new DomainError("BRANCH_HAS_CASES", 409, "لا يمكن نقل فرع لديه شكاوى إلى علامة أخرى");
      const { error } = await db.from("branches").update(row).eq("id", data.id);
      c.rpcError(error);
      await db.rpc("write_audit", { _actor: a.id, _action: "BRANCH_UPDATED", _entity: data.id });
      return { id: data.id };
    }
    const { data: created, error } = await db.from("branches").insert({ ...row, active: false }).select("id").single();
    if (error?.message.includes("branches_code_key")) throw new DomainError("CODE_TAKEN", 409, "رمز الفرع مستخدم");
    c.rpcError(error);
    await db.rpc("write_audit", { _actor: a.id, _action: "BRANCH_CREATED", _entity: created!.id });
    return { id: created!.id };
  });

export const setBranchActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "directory.activate");
    const db = await c.admin();
    const { error } = await db.from("branches").update({ active: data.active }).eq("id", data.id);
    c.rpcError(error);
    await db.rpc("write_audit", { _actor: a.id, _action: data.active ? "BRANCH_ACTIVATED" : "BRANCH_DEACTIVATED", _entity: data.id });
    return { ok: true };
  });

/* ---------------- QR: one active code per pickup branch ---------------- */
export const listQrs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    if (!can(a, "configure")) return [];
    const db = await c.admin();
    const { data } = await db.from("qrs").select("id,branch_id,active,scans,created_at,revoked_at, branches!inner(brand_id)").eq("active", true);
    return (data ?? [])
      .filter((q) => inScope(a, { brandId: (q.branches as { brand_id: string }).brand_id, branchId: q.branch_id }))
      .map((q) => ({ id: q.id, branchId: q.branch_id, scans: q.scans, createdAt: q.created_at }));
  });

export const qrForBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ branchId: z.string().uuid(), origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const { encrypt, decrypt, keyedHash, randomToken } = await import("./crypto.server");
    const a = await c.requireActor(context as never);
    authorize(a, "configure");
    const db = await c.admin();
    const { data: br } = await db.from("branches").select("brand_id,active").eq("id", data.branchId).maybeSingle();
    if (!br || !inScope(a, { brandId: br.brand_id, branchId: data.branchId }) || !br.active) throw new DomainError("NOT_FOUND", 404, "الفرع غير متاح أو غير مفعل");
    const code = randomToken();
    const { data: res, error } = await db.rpc("qr_ensure", { _branch: data.branchId, _hash: await keyedHash("qr:" + code), _code_enc: await encrypt(code), _actor: a.id });
    c.rpcError(error);
    const out = res as { id: string; code_enc: string };
    return { id: out.id, url: `${new URL(data.origin).origin}/q/${await decrypt(out.code_enc)}` };
  });

export const retireQr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), rotate: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const { encrypt, keyedHash, randomToken } = await import("./crypto.server");
    const a = await c.requireActor(context as never);
    authorize(a, "configure");
    const db = await c.admin();
    const { data: q } = await db.from("qrs").select("branch_id, branches!inner(brand_id)").eq("id", data.id).maybeSingle();
    if (!q || !inScope(a, { brandId: (q.branches as { brand_id: string }).brand_id, branchId: q.branch_id })) throw new DomainError("NOT_FOUND", 404, "غير متاح");
    const code = data.rotate ? randomToken() : null;
    const { error } = await db.rpc("qr_retire", {
      _id: data.id, _actor: a.id, _new_hash: (code ? await keyedHash("qr:" + code) : null) as never, _new_code_enc: (code ? await encrypt(code) : null) as never,
    });
    c.rpcError(error);
    return { ok: true };
  });

/* ---------------- Staff accounts (verified provisioning, no self-signup) ---------------- */
const staffInput = z.object({
  name: z.string().trim().min(2).max(100),
  role: z.enum(assignableRoles),
  financeDuty: z.enum(financeDuties),
  brandIds: z.array(z.string()).min(1, "اختر علامة واحدة على الأقل"),
  branchIds: z.array(z.string().uuid()).default([]),
});

export const listStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "users.manage");
    const db = await c.admin();
    const { data } = await db.from("user_roles").select("*").order("created_at");
    return data ?? [];
  });

export const createStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => staffInput.extend({ email: z.string().email(), password: z.string().min(12, "كلمة المرور 12 حرفاً على الأقل") }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "users.manage");
    const db = await c.admin();
    // Creates a confirmed account with an admin-set temporary password. No invite email is sent.
    const { data: created, error } = await db.auth.admin.createUser({ email: data.email, password: data.password, email_confirm: true });
    if (error || !created.user) throw new DomainError("CREATE_FAILED", 400, error?.message.includes("already") ? "البريد مسجل مسبقاً" : "تعذر إنشاء الحساب");
    const { error: e2 } = await db.from("user_roles").insert({
      user_id: created.user.id, email: data.email, name: data.name, role: data.role, finance_duty: data.financeDuty,
      brand_ids: data.brandIds, branch_ids: data.branchIds, enabled: true,
    });
    c.rpcError(e2);
    await db.rpc("write_audit", { _actor: a.id, _action: `USER_CREATED_${data.role}`, _entity: created.user.id });
    return { id: created.user.id };
  });

export const updateStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => staffInput.extend({ userId: z.string().uuid(), enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "users.manage");
    if (data.userId === a.id && (!data.enabled || data.role !== a.role)) throw new DomainError("SELF_LOCKOUT", 400, "لا يمكنك تعطيل حسابك أو تغيير دورك");
    const db = await c.admin();
    const { error } = await db.from("user_roles").update({
      name: data.name, role: data.role, finance_duty: data.financeDuty, brand_ids: data.brandIds, branch_ids: data.branchIds, enabled: data.enabled, updated_at: new Date().toISOString(),
    }).eq("user_id", data.userId);
    c.rpcError(error);
    // Disabled staff: role row blocks every server function and RLS read immediately; the ban stops token refresh.
    await db.auth.admin.updateUserById(data.userId, { ban_duration: data.enabled ? "none" : "876000h" });
    await db.rpc("write_audit", { _actor: a.id, _action: data.enabled ? "USER_UPDATED" : "USER_DISABLED", _entity: data.userId });
    return { ok: true };
  });

/** First SUPER_ADMIN: only when none exists, only for the verified email named in the BOOTSTRAP_ADMIN_EMAIL secret, only after MFA. */
export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await core();
    const expected = (process.env["BOOTSTRAP_ADMIN_EMAIL"] ?? "").trim().toLowerCase();
    if (!expected) throw new DomainError("BOOTSTRAP_NOT_CONFIGURED", 409, "لم يتم إعداد بريد المدير الأول بعد");
    if (context.claims["aal"] !== "aal2") throw new DomainError("MFA_REQUIRED", 401, "فعّل التحقق بخطوتين أولاً");
    const db = await c.admin();
    const { data: u } = await db.auth.admin.getUserById(context.userId);
    if (!u.user?.email_confirmed_at || u.user.email?.toLowerCase() !== expected) throw new DomainError("FORBIDDEN", 403, "هذا الحساب غير مخول");
    const { count } = await db.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "SUPER_ADMIN");
    if ((count ?? 0) > 0) throw new DomainError("ALREADY_PROVISIONED", 409, "تم تعيين مدير النظام مسبقاً");
    const { data: brands } = await db.from("brands").select("id");
    const { error } = await db.from("user_roles").insert({ user_id: context.userId, email: u.user.email!, name: "مدير النظام", role: "SUPER_ADMIN", brand_ids: (brands ?? []).map((b) => b.id) });
    c.rpcError(error);
    await db.rpc("write_audit", { _actor: context.userId, _action: "FIRST_SUPER_ADMIN", _entity: context.userId });
    return { ok: true };
  });

/* ---------------- Shared staffing schedule ---------------- */
export const listShifts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ from: z.string().datetime(), to: z.string().datetime() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    await c.requireActor(context as never);
    const { data: rows } = await context.supabase.from("shifts").select("*").is("cancelled_at", null).lt("start_at", data.to).gt("end_at", data.from).order("start_at");
    return rows ?? [];
  });

const shiftEntry = z.object({
  userId: z.string().uuid(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  breakStart: z.string().datetime().optional().nullable(),
  breakEnd: z.string().datetime().optional().nullable(),
  lead: z.boolean().default(false),
  dayOff: z.boolean().default(false),
});
export const saveShifts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ entries: z.array(shiftEntry).min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "schedule");
    const es = data.entries;
    for (let i = 0; i < es.length; i++) {
      const e = es[i]!;
      if (+new Date(e.end) <= +new Date(e.start)) throw new DomainError("INVALID_SHIFT", 400, "نهاية الدوام بعد بدايته");
      if ((e.breakStart == null) !== (e.breakEnd == null)) throw new DomainError("INVALID_BREAK", 400, "حدد بداية ونهاية الاستراحة");
      for (let j = i + 1; j < es.length; j++)
        if (es[j]!.userId === e.userId && overlaps(new Date(e.start), new Date(e.end), new Date(es[j]!.start), new Date(es[j]!.end)))
          throw new DomainError("OVERLAP", 409, "يوجد تداخل بين دوامين للموظف نفسه في الإدخال");
    }
    const db = await c.admin();
    const { data: staff } = await db.from("user_roles").select("user_id").in("user_id", es.map((e) => e.userId)).eq("enabled", true);
    if ((staff ?? []).length !== new Set(es.map((e) => e.userId)).size) throw new DomainError("INVALID_STAFF", 400, "موظف غير متاح");
    const { data: n, error } = await db.rpc("save_shifts_tx", {
      _actor: a.id,
      _entries: es.map((e) => ({ user_id: e.userId, start_at: e.start, end_at: e.end, break_start: e.dayOff ? null : e.breakStart ?? null, break_end: e.dayOff ? null : e.breakEnd ?? null, lead: e.lead, day_off: e.dayOff })) as never,
    });
    c.rpcError(error);
    return { saved: n };
  });

export const cancelShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), version: z.number().int() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "schedule");
    const db = await c.admin();
    const { data: rows, error } = await db.from("shifts").update({ cancelled_at: new Date().toISOString(), version: data.version + 1 }).eq("id", data.id).eq("version", data.version).is("cancelled_at", null).select("id");
    c.rpcError(error);
    if (!rows?.length) throw new DomainError("CONFLICT", 409, "تم تعديل الدوام؛ حدّث الصفحة");
    await db.rpc("write_audit", { _actor: a.id, _action: "SHIFT_CANCELLED", _entity: data.id });
    return { ok: true };
  });

/* ---------------- Scoped reports (full-dataset totals) ---------------- */
const reportInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  brandId: z.string().optional(),
  source: z.enum(["PUBLIC_QR", "PHONE_AGENT"]).optional(),
  priority: z.enum(["P1", "P2", "P3"]).optional(),
  csv: z.boolean().default(false),
}).refine((v) => v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) / 86400000 < 366, "اختر فترة لا تتجاوز 366 يوماً.");

export const runReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => reportInput.parse(d))
  .handler(async ({ data: q, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "report");
    const start = new Date(q.from + "T00:00:00+03:00").toISOString();
    const end = new Date(Date.parse(q.to + "T00:00:00+03:00") + 86400000).toISOString();
    type Row = { sequence: number; created_at: string; brand_id: string; branch_id: string | null; state: string; source: string; category: string; priority: string; escalated: boolean; received_at: string; closed_at: string | null };
    const rows: Row[] = [];
    // Page through the whole scoped dataset so totals are never capped by the 1000-row API limit.
    for (let off = 0; ; off += 1000) {
      let qb = context.supabase.from("tickets").select("sequence,created_at,brand_id,branch_id,state,source,category,priority,escalated,received_at,closed_at").gte("received_at", start).lt("received_at", end);
      if (q.brandId) qb = qb.eq("brand_id", q.brandId);
      if (q.source) qb = qb.eq("source", q.source);
      if (q.priority) qb = qb.eq("priority", q.priority);
      const { data, error } = await qb.order("received_at").range(off, off + 999);
      if (error) throw error;
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    const db = await c.admin();
    if (q.csv) {
      await db.rpc("write_audit", { _actor: a.id, _action: "MASKED_CSV_EXPORTED", _entity: q.brandId ?? "SCOPED" });
      const header = ["رقم البلاغ", "العلامة", "الفرع", "الحالة", "الأولوية", "المصدر", "التصنيف", "وقت الاستقبال (UTC)"];
      const csv = "\uFEFF" + [header, ...rows.map((r) => [ticketNumber(r.sequence, r.created_at), r.brand_id, r.branch_id ?? "غير معروف", stateLabels[r.state] ?? r.state, r.priority, r.source, categoryLabels[r.category] ?? r.category, r.received_at])].map((row) => row.map(safeCell).join(",")).join("\r\n");
      return { csv };
    }
    const count = <K extends keyof Row>(k: K) => rows.reduce<Record<string, number>>((m, r) => ((m[String(r[k] ?? "—")] = (m[String(r[k] ?? "—")] ?? 0) + 1), m), {});
    const durations = rows.filter((r) => r.state === "CLOSED" && r.closed_at && +new Date(r.closed_at) >= +new Date(r.received_at)).map((r) => (+new Date(r.closed_at!) - +new Date(r.received_at)) / 3600000).sort((x, y) => x - y);
    const mid = Math.floor(durations.length / 2);
    return {
      total: rows.length,
      closed: rows.filter((r) => r.state === "CLOSED").length,
      open: rows.filter((r) => r.state !== "CLOSED").length,
      escalated: rows.filter((r) => r.escalated).length,
      medianHours: durations.length ? (durations.length % 2 ? durations[mid]! : (durations[mid - 1]! + durations[mid]!) / 2) : null,
      byBrand: count("brand_id"), byBranch: count("branch_id"), byState: count("state"), bySource: count("source"), byCategory: count("category"), byPriority: count("priority"),
    };
  });

/* ---------------- Activation settings (SUPER_ADMIN) ---------------- */
export const updateSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ key: z.enum(["public_intake_enabled", "require_mfa"]), value: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "users.manage");
    const db = await c.admin();
    const { error } = await db.from("app_settings").update({ value: data.value, updated_at: new Date().toISOString() }).eq("key", data.key);
    c.rpcError(error);
    await db.rpc("write_audit", { _actor: a.id, _action: `SETTING_${data.key}_${data.value}`, _entity: data.key });
    return { ok: true };
  });

/* ---------------- Private evidence ---------------- */
export const uploadEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticketId: z.string().uuid().optional(), refundId: z.string().uuid().optional(), mime: z.string(), base64: z.string().max(11_200_000) }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "evidence.attach");
    if (!!data.ticketId === !!data.refundId) throw new DomainError("OWNER_REQUIRED", 400, "حدد شكوى أو طلباً مالياً واحداً");
    const owner = data.ticketId
      ? (await context.supabase.from("tickets").select("brand_id,branch_id").eq("id", data.ticketId).maybeSingle()).data
      : (await context.supabase.from("refunds").select("brand_id,branch_id").eq("id", data.refundId!).maybeSingle()).data;
    if (!owner || !inScope(a, { brandId: owner.brand_id, branchId: owner.branch_id })) throw new DomainError("NOT_FOUND", 404, "خارج نطاقك");
    const raw = Uint8Array.from(atob(data.base64), (ch) => ch.charCodeAt(0));
    if (raw.length > 8 * 1024 * 1024) throw new DomainError("TOO_LARGE", 400, "الحد الأقصى 8MB");
    // Images only, rebuilt from pixels before storage (see evidence.server.ts).
    const { cleanPhoto, putEvidence, sha256Hex } = await import("./evidence.server");
    const bytes = cleanPhoto(raw);
    const db = await c.admin();
    const key = `${data.ticketId ? "t/" + data.ticketId : "r/" + data.refundId}/${crypto.randomUUID()}`;
    c.rpcError(await putEvidence(key, bytes, "image/jpeg"));
    const { data: row, error: e2 } = await db.from("attachments").insert({
      ticket_id: data.ticketId ?? null, refund_id: data.refundId ?? null, storage_key: key, mime: "image/jpeg", size: bytes.length,
      checksum: await sha256Hex(bytes), status: "CLEAN", uploaded_by: a.id,
    }).select("id").single();
    c.rpcError(e2);
    await db.rpc("write_audit", { _actor: a.id, _action: "EVIDENCE_UPLOADED", _entity: row!.id });
    return { id: row!.id, status: "CLEAN" };
  });

/** Short-lived signed link, only for CLEAN (rebuilt) files. No public evidence URLs exist. */
export const evidenceLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "evidence.view");
    const { data: f } = await context.supabase.from("attachments").select("storage_key,status").eq("id", data.id).maybeSingle();
    if (!f) throw new DomainError("NOT_FOUND", 404, "غير متاح");
    if (f.status === "PENDING_SCAN") {
      const { clearPending } = await import("./evidence.server");
      if (await clearPending(data.id, f.storage_key, a.id)) f.status = "CLEAN";
    }
    if (f.status !== "CLEAN") throw new DomainError("SCAN_PENDING", 409, "الملف بانتظار فحص الأمان");
    const db = await c.admin();
    const { data: s } = await db.storage.from("evidence").createSignedUrl(f.storage_key, 60);
    await db.rpc("write_audit", { _actor: a.id, _action: "EVIDENCE_VIEWED", _entity: data.id });
    return { url: s?.signedUrl ?? null };
  });
