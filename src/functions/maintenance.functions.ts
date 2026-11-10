import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DomainError, authorize, inScope, permissionsForRole } from "@/lib/domain";
import {
  MAINTENANCE_ACTIONS,
  MAINTENANCE_PRIORITIES,
  maintenanceActions,
  maintenanceDeadlines,
  maintenanceTransition,
  toMaintenanceSettings,
  type MaintenanceRequest,
} from "@/lib/maintenance";

/*
 * Maintenance app. Reads use the signed-in user's client, so row-level
 * security limits them to the user's role and branches. Every change is
 * authorized here, then written by a service-role SQL procedure together
 * with its event and audit row.
 */
const core = () => import("./core.server");
const MAX_PHOTOS = 3;

type Row = {
  id: string;
  number: number;
  brand_id: string;
  branch_id: string;
  category: string;
  priority: string;
  title: string;
  description: string;
  state: string;
  requester: string;
  assignee: string | null;
  respond_due_at: string | null;
  fix_due_at: string | null;
  created_at: string;
  assigned_at: string | null;
  started_at: string | null;
  done_at: string | null;
  confirmed_at: string | null;
  version: number;
};
const toRequest = (r: Row): MaintenanceRequest => ({
  id: r.id,
  number: Number(r.number),
  brandId: r.brand_id,
  branchId: r.branch_id,
  category: r.category,
  priority: r.priority as MaintenanceRequest["priority"],
  title: r.title,
  description: r.description,
  state: r.state as MaintenanceRequest["state"],
  requester: r.requester,
  assignee: r.assignee,
  respondDueAt: r.respond_due_at,
  fixDueAt: r.fix_due_at,
  createdAt: r.created_at,
  assignedAt: r.assigned_at,
  startedAt: r.started_at,
  doneAt: r.done_at,
  confirmedAt: r.confirmed_at,
  version: r.version,
});

async function loadSettings() {
  const db = await (await core()).admin();
  const { data } = await db.from("app_settings").select("value").eq("key", "maintenance").maybeSingle();
  return toMaintenanceSettings(data?.value);
}

/** Requests the user can see, the people they can be assigned to, and the settings. */
export const maintenanceBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ status: z.enum(["open", "closed", "all"]).default("open") }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "mnt.view");
    let q = context.supabase.from("maintenance_requests" as never).select("*");
    if (data.status === "open") q = q.not("state", "in", "(CONFIRMED,CANCELLED)");
    if (data.status === "closed") q = q.in("state", ["CONFIRMED", "CANCELLED"]);
    const { data: rows, error } = await q.order("created_at", { ascending: false }).limit(500);
    if (error) throw new DomainError("LOAD_FAILED", 500, "تعذر تحميل طلبات الصيانة");
    const staff = await c.staffDirectory(a.role === "SUPER_ADMIN" ? (await allBrands()) : a.brandIds);
    return {
      requests: ((rows ?? []) as unknown as Row[]).map(toRequest),
      // Names for requesters and technicians; technicians are offered for assignment.
      people: staff
        .filter((u) => permissionsForRole(u.role).some((p) => p.startsWith("mnt.")))
        .map((u) => ({ id: u.id, name: u.name, role: u.role, brandIds: u.brandIds, branchIds: u.branchIds })),
      settings: await loadSettings(),
    };
  });

async function allBrands() {
  const db = await (await core()).admin();
  const { data } = await db.from("brands").select("id");
  return (data ?? []).map((b) => b.id as string);
}

/** One request with its history and photos. */
export const maintenanceDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "mnt.view");
    const { data: row } = await context.supabase
      .from("maintenance_requests" as never)
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new DomainError("NOT_FOUND", 404, "الطلب غير متاح ضمن صلاحياتك");
    const [{ data: events }, { data: photos }] = await Promise.all([
      context.supabase
        .from("maintenance_events" as never)
        .select("id,type,actor,note,created_at")
        .eq("request_id", data.id)
        .order("created_at"),
      context.supabase
        .from("maintenance_photos" as never)
        .select("id,stage,created_at")
        .eq("request_id", data.id)
        .order("created_at"),
    ]);
    return {
      request: toRequest(row as unknown as Row),
      events: ((events ?? []) as unknown as { id: string; type: string; actor: string; note: string | null; created_at: string }[]).map(
        (e) => ({ id: e.id, type: e.type, actor: e.actor, note: e.note, createdAt: e.created_at }),
      ),
      photos: ((photos ?? []) as unknown as { id: string; stage: string; created_at: string }[]).map((p) => ({
        id: p.id,
        stage: p.stage as "BEFORE" | "AFTER",
        createdAt: p.created_at,
      })),
    };
  });

/** A branch (or the maintenance manager) asks for a repair. */
export const maintenanceCreate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        branchId: z.string().uuid({ message: "اختر الفرع" }),
        category: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "اختر نوع العطل"),
        priority: z.enum(MAINTENANCE_PRIORITIES),
        title: z.string().trim().min(3, "اكتب عنواناً قصيراً للعطل").max(120),
        description: z.string().trim().max(2000).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    if (!permissionsForRole(a.role).some((p) => p === "mnt.request" || p === "mnt.assign"))
      throw new DomainError("FORBIDDEN", 403, "لا تملك صلاحية طلب صيانة");
    const db = await c.admin();
    const { data: branch } = await db
      .from("branches")
      .select("id,brand_id,active")
      .eq("id", data.branchId)
      .maybeSingle();
    if (!branch || !branch.active) throw new DomainError("INVALID_BRANCH", 400, "الفرع غير موجود أو غير مفعل");
    if (!inScope(a, { brandId: branch.brand_id, branchId: branch.id }))
      throw new DomainError("FORBIDDEN", 403, "هذا الفرع خارج نطاقك");
    const s = await loadSettings();
    if (!s.categories.some((x) => x.id === data.category && x.active))
      throw new DomainError("INVALID_CATEGORY", 400, "نوع العطل غير متاح؛ اختر من القائمة");
    const due = maintenanceDeadlines(data.priority, new Date(), s.sla);
    const { data: res, error } = await db.rpc("maintenance_create_tx" as never, {
      p: {
        brand_id: branch.brand_id,
        branch_id: branch.id,
        category: data.category,
        priority: data.priority,
        title: data.title,
        description: data.description,
        requester: a.id,
        respond_due_at: due.respondDueAt,
        fix_due_at: due.fixDueAt,
      },
    } as never);
    c.rpcError(error);
    return res as unknown as { id: string; number: number };
  });

/** Assign, start, done, confirm, reopen, cancel or comment. */
export const maintenanceAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        version: z.number().int().min(1),
        action: z.enum(MAINTENANCE_ACTIONS),
        assignee: z.string().uuid().optional(),
        note: z.string().trim().max(2000).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    const db = await c.admin();
    const { data: row } = await db.from("maintenance_requests" as never).select("*").eq("id", data.id).maybeSingle();
    if (!row) throw new DomainError("NOT_FOUND", 404, "الطلب غير موجود");
    const r = toRequest(row as unknown as Row);
    const permissions = permissionsForRole(a.role, a.financeDuty);
    const visible =
      inScope(a, { brandId: r.brandId, branchId: r.branchId }) &&
      (a.role !== "TECHNICIAN" || r.assignee === a.id);
    if (!visible || !maintenanceActions(r, { id: a.id, permissions }).includes(data.action))
      throw new DomainError("FORBIDDEN", 403, "لا يمكن تنفيذ هذا الإجراء على الطلب الآن");
    if ((data.action === "comment" || data.action === "reopen") && !data.note)
      throw new DomainError("NOTE_REQUIRED", 400, data.action === "reopen" ? "اكتب سبب إعادة الفتح" : "اكتب الملاحظة");
    const patch: Record<string, unknown> = { ...maintenanceTransition(data.action, new Date()) };
    let note = data.note || null;
    if (data.action === "assign") {
      if (!data.assignee) throw new DomainError("ASSIGNEE_REQUIRED", 400, "اختر الفني");
      const { data: tech } = await db
        .from("user_roles")
        .select("user_id,name,role,brand_ids,branch_ids,enabled")
        .eq("user_id", data.assignee)
        .maybeSingle();
      const techActor = tech && {
        id: tech.user_id,
        name: tech.name,
        role: tech.role,
        brandIds: tech.brand_ids,
        branchIds: tech.branch_ids,
      };
      if (
        !techActor ||
        !tech.enabled ||
        !permissionsForRole(tech.role).includes("mnt.work") ||
        !inScope(techActor, { brandId: r.brandId, branchId: r.branchId })
      )
        throw new DomainError("INVALID_ASSIGNEE", 400, "هذا الموظف لا يعمل على صيانة هذا الفرع");
      patch["assignee"] = tech.user_id;
      if (r.state === "NEW") patch["state"] = "ASSIGNED";
      note = [tech.name, data.note].filter(Boolean).join(" — ");
    }
    const { error } = await db.rpc("maintenance_action_tx" as never, {
      _id: r.id,
      _version: data.version,
      p: patch,
      _type: data.action.toUpperCase(),
      _note: note,
      _actor: a.id,
    } as never);
    c.rpcError(error);
    return { ok: true };
  });

/** Photos of the problem (before) or of the repair (after), rebuilt like every other photo. */
export const maintenancePhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        stage: z.enum(["BEFORE", "AFTER"]),
        base64: z.string().min(1).max(11_200_000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "mnt.view");
    // Readable through the user's own access means they may add photos to it.
    const { data: row } = await context.supabase
      .from("maintenance_requests" as never)
      .select("id,state,assignee")
      .eq("id", data.id)
      .maybeSingle();
    const req = row as unknown as { id: string; state: string; assignee: string | null } | null;
    if (!req || ["CONFIRMED", "CANCELLED"].includes(req.state))
      throw new DomainError("FORBIDDEN", 403, "لا يمكن إضافة صور لهذا الطلب");
    const permissions = permissionsForRole(a.role);
    if (!permissions.some((p) => ["mnt.request", "mnt.assign", "mnt.work"].includes(p)))
      throw new DomainError("FORBIDDEN", 403, "لا تملك صلاحية إضافة صور");
    const db = await c.admin();
    const { count } = await db
      .from("maintenance_photos" as never)
      .select("id", { count: "exact", head: true })
      .eq("request_id", data.id)
      .eq("stage", data.stage);
    if ((count ?? 0) >= MAX_PHOTOS)
      throw new DomainError("FILE_COUNT", 400, `الحد الأعلى ${MAX_PHOTOS} صور`);
    const raw = Uint8Array.from(atob(data.base64), (ch) => ch.charCodeAt(0));
    if (raw.length > 8 * 1024 * 1024) throw new DomainError("TOO_LARGE", 400, "يسمح بصور حتى 8 ميغابايت");
    const { cleanPhoto, putEvidence } = await import("./evidence.server");
    const bytes = cleanPhoto(raw);
    const key = `m/${data.id}/${crypto.randomUUID()}`;
    c.rpcError(await putEvidence(key, bytes, "image/jpeg"));
    const { error } = await db.from("maintenance_photos" as never).insert({
      request_id: data.id,
      stage: data.stage,
      storage_key: key,
      size: bytes.length,
      uploaded_by: a.id,
    } as never);
    c.rpcError(error);
    await db.from("maintenance_events" as never).insert({
      request_id: data.id,
      type: data.stage === "AFTER" ? "PHOTO_AFTER" : "PHOTO_BEFORE",
      actor: a.id,
    } as never);
    return { ok: true };
  });

/** A short-lived link to view one photo. */
export const maintenancePhotoLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "mnt.view");
    const { data: photo } = await context.supabase
      .from("maintenance_photos" as never)
      .select("storage_key")
      .eq("id", data.id)
      .maybeSingle();
    const key = (photo as unknown as { storage_key: string } | null)?.storage_key;
    if (!key) throw new DomainError("NOT_FOUND", 404, "الصورة غير متاحة");
    const db = await c.admin();
    const { data: s } = await db.storage.from("evidence").createSignedUrl(key, 60);
    return { url: s?.signedUrl ?? null };
  });

const deadline = z.object({
  respond: z.number().positive("المهلة بالساعات أكبر من صفر").max(1440),
  fix: z.number().positive("المهلة بالساعات أكبر من صفر").max(1440),
});

/** Fault types and deadlines (maintenance manager and super admin). */
export const maintenanceSaveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        categories: z
          .array(
            z.object({
              id: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
              label: z.string().trim().min(2, "اكتب اسم نوع العطل").max(60),
              active: z.boolean(),
            }),
          )
          .min(1)
          .max(60),
        sla: z.object({ URGENT: deadline, HIGH: deadline, NORMAL: deadline }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "mnt.configure");
    for (const p of MAINTENANCE_PRIORITIES)
      if (data.sla[p].fix < data.sla[p].respond)
        throw new DomainError("INVALID_SLA", 400, "مهلة الإصلاح يجب ألا تقل عن مهلة بدء العمل");
    const db = await c.admin();
    const { error } = await db
      .from("app_settings")
      .upsert({ key: "maintenance", value: data as never, updated_at: new Date().toISOString() });
    c.rpcError(error);
    await db.rpc("write_audit", { _actor: a.id, _action: "MAINTENANCE_SETTINGS_UPDATED", _entity: "maintenance" });
    return toMaintenanceSettings(data);
  });
