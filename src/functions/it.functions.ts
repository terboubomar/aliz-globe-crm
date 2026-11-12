import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DomainError, authorize, permissionsForRole, safeCell, type Actor } from "@/lib/domain";
import {
  IT_ACTIONS,
  IT_PRIORITIES,
  itActions,
  itAsksDetail,
  itCategoryText,
  itDeadlines,
  itLate,
  itNumber,
  itPriorityLabels,
  itStateLabels,
  itTransition,
  toItSettings,
  type ItTicket,
} from "@/lib/it";

/*
 * IT app. Any staff member opens a ticket and follows their own; the IT manager
 * sees all tickets and assigns IT specialists, who see only theirs. Reads use
 * the signed-in user's client (row-level security applies); every change is
 * checked here, then written by a service-role SQL procedure together with its
 * event and audit row.
 */
const core = () => import("./core.server");
const MAX_PHOTOS = 3;

type Row = {
  id: string;
  number: number;
  brand_id: string | null;
  branch_id: string | null;
  department: string;
  category: string;
  category_detail: string | null;
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
const toTicket = (r: Row): ItTicket => ({
  id: r.id,
  number: Number(r.number),
  brandId: r.brand_id,
  branchId: r.branch_id,
  department: r.department,
  category: r.category,
  categoryDetail: r.category_detail ?? null,
  priority: r.priority as ItTicket["priority"],
  title: r.title,
  description: r.description,
  state: r.state as ItTicket["state"],
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
  const { data } = await db.from("app_settings").select("value").eq("key", "it").maybeSingle();
  return toItSettings(data?.value);
}
async function allBrands() {
  const db = await (await core()).admin();
  const { data } = await db.from("brands").select("id");
  return (data ?? []).map((b) => b.id as string);
}
const may = (a: Actor, p: string) => permissionsForRole(a.role, a.financeDuty).includes(p);
/** Same rule as the database: IT manager and super admin see all, others their own or assigned. */
const sees = (a: Actor, t: ItTicket) =>
  a.role === "SUPER_ADMIN" ||
  a.role === "IT_MANAGER" ||
  t.requester === a.id ||
  (a.role === "IT_SPECIALIST" && t.assignee === a.id);
function mayUse(a: Actor) {
  if (!may(a, "it.request") && !may(a, "it.view"))
    throw new DomainError("FORBIDDEN", 403, "لا تملك صلاحية تذاكر الدعم الفني");
}

/** Tickets the user can see, names of the people on them, and the settings. */
export const itBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ status: z.enum(["open", "closed", "all"]).default("open") }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    mayUse(a);
    let q = context.supabase.from("it_tickets" as never).select("*");
    if (data.status === "open") q = q.not("state", "in", "(CONFIRMED,CANCELLED)");
    if (data.status === "closed") q = q.in("state", ["CONFIRMED", "CANCELLED"]);
    const { data: rows, error } = await q.order("created_at", { ascending: false }).limit(500);
    if (error) throw new DomainError("LOAD_FAILED", 500, "تعذر تحميل تذاكر الدعم الفني");
    const tickets = ((rows ?? []) as unknown as Row[]).map(toTicket);
    // IT is company-wide: names come from every brand. Plain requesters only get
    // the names on their own tickets; the IT manager also gets the IT team.
    const staff = await c.staffDirectory(await allBrands());
    const onTickets = new Set(tickets.flatMap((t) => [t.requester, t.assignee ?? ""]));
    const assigner = may(a, "it.assign");
    return {
      tickets,
      people: staff
        .filter(
          (u) =>
            onTickets.has(u.id) || (assigner && permissionsForRole(u.role).includes("it.work")),
        )
        .map((u) => ({ id: u.id, name: u.name, role: u.role })),
      settings: await loadSettings(),
    };
  });

/** One ticket with its history and photos. */
export const itDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    mayUse(a);
    const { data: row } = await context.supabase
      .from("it_tickets" as never)
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new DomainError("NOT_FOUND", 404, "التذكرة غير متاحة ضمن صلاحياتك");
    const [{ data: events }, { data: photos }] = await Promise.all([
      context.supabase
        .from("it_events" as never)
        .select("id,type,actor,note,created_at")
        .eq("ticket_id", data.id)
        .order("created_at"),
      context.supabase
        .from("it_photos" as never)
        .select("id,stage,created_at")
        .eq("ticket_id", data.id)
        .order("created_at"),
    ]);
    return {
      ticket: toTicket(row as unknown as Row),
      events: (
        (events ?? []) as unknown as {
          id: string;
          type: string;
          actor: string;
          note: string | null;
          created_at: string;
        }[]
      ).map((e) => ({
        id: e.id,
        type: e.type,
        actor: e.actor,
        note: e.note,
        createdAt: e.created_at,
      })),
      photos: (
        (photos ?? []) as unknown as { id: string; stage: string; created_at: string }[]
      ).map((p) => ({ id: p.id, stage: p.stage as "BEFORE" | "AFTER", createdAt: p.created_at })),
    };
  });

/** Any staff member opens a ticket; the branch is optional. */
export const itCreate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        department: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "اختر القسم"),
        branchId: z.string().uuid().or(z.literal("")).default(""),
        category: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "اختر نوع المشكلة"),
        categoryDetail: z.string().trim().max(120).default(""),
        priority: z.enum(IT_PRIORITIES),
        title: z.string().trim().min(3, "اكتب عنواناً قصيراً للمشكلة").max(120),
        description: z.string().trim().max(2000).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    if (!may(a, "it.request")) throw new DomainError("FORBIDDEN", 403, "لا تملك صلاحية فتح تذكرة");
    const db = await c.admin();
    const s = await loadSettings();
    if (!s.departments.some((x) => x.id === data.department && x.active))
      throw new DomainError("INVALID_DEPARTMENT", 400, "القسم غير متاح؛ اختر من القائمة");
    let brandId = "",
      branchId = "";
    if (data.branchId) {
      const { data: branch } = await db
        .from("branches")
        .select("id,brand_id,active")
        .eq("id", data.branchId)
        .maybeSingle();
      if (!branch || !branch.active)
        throw new DomainError("INVALID_BRANCH", 400, "الفرع غير موجود أو غير مفعل");
      // Someone limited to certain branches can only name those.
      if (a.branchIds.length && !a.branchIds.includes(branch.id))
        throw new DomainError("FORBIDDEN", 403, "هذا الفرع خارج نطاقك");
      brandId = branch.brand_id;
      branchId = branch.id;
    } else if (data.department === "BRANCHES")
      throw new DomainError("BRANCH_REQUIRED", 400, "اختر الفرع");
    const category = s.categories.find((x) => x.id === data.category && x.active);
    if (!category)
      throw new DomainError("INVALID_CATEGORY", 400, "نوع المشكلة غير متاح؛ اختر من القائمة");
    const detail = itAsksDetail(category) ? data.categoryDetail.replace(/\s+/g, " ") : "";
    if (itAsksDetail(category) && detail.length < 3)
      throw new DomainError("DETAIL_REQUIRED", 400, "اكتب نوع المشكلة عند اختيار «أخرى»");
    const due = itDeadlines(data.priority, new Date(), s.sla);
    const { data: res, error } = await db.rpc(
      "it_create_tx" as never,
      {
        p: {
          brand_id: brandId,
          branch_id: branchId,
          department: data.department,
          category: data.category,
          category_detail: detail,
          priority: data.priority,
          title: data.title,
          description: data.description,
          requester: a.id,
          respond_due_at: due.respondDueAt,
          fix_due_at: due.fixDueAt,
        },
      } as never,
    );
    c.rpcError(error);
    return res as unknown as { id: string; number: number };
  });

/** Assign, start, done, confirm, reopen, cancel or comment. */
export const itAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        version: z.number().int().min(1),
        action: z.enum(IT_ACTIONS),
        assignee: z.string().uuid().optional(),
        note: z.string().trim().max(2000).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    const db = await c.admin();
    const { data: row } = await db
      .from("it_tickets" as never)
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new DomainError("NOT_FOUND", 404, "التذكرة غير موجودة");
    const t = toTicket(row as unknown as Row);
    const permissions = permissionsForRole(a.role, a.financeDuty);
    if (!sees(a, t) || !itActions(t, { id: a.id, permissions }).includes(data.action))
      throw new DomainError("FORBIDDEN", 403, "لا يمكن تنفيذ هذا الإجراء على التذكرة الآن");
    if ((data.action === "comment" || data.action === "reopen") && !data.note)
      throw new DomainError(
        "NOTE_REQUIRED",
        400,
        data.action === "reopen" ? "اكتب سبب إعادة الفتح" : "اكتب الملاحظة",
      );
    const patch: Record<string, unknown> = { ...itTransition(data.action, new Date()) };
    let note = data.note || null;
    if (data.action === "assign") {
      if (!data.assignee) throw new DomainError("ASSIGNEE_REQUIRED", 400, "اختر المختص");
      const { data: who } = await db
        .from("user_roles")
        .select("user_id,name,role,enabled")
        .eq("user_id", data.assignee)
        .maybeSingle();
      if (!who || !who.enabled || !permissionsForRole(who.role).includes("it.work"))
        throw new DomainError("INVALID_ASSIGNEE", 400, "هذا الموظف ليس من فريق تقنية المعلومات");
      patch["assignee"] = who.user_id;
      if (t.state === "NEW") patch["state"] = "ASSIGNED";
      note = [who.name, data.note].filter(Boolean).join(" — ");
    }
    const { error } = await db.rpc(
      "it_action_tx" as never,
      {
        _id: t.id,
        _version: data.version,
        p: patch,
        _type: data.action.toUpperCase(),
        _note: note,
        _actor: a.id,
      } as never,
    );
    c.rpcError(error);
    return { ok: true };
  });

/** Screenshots of the problem (before) or of the fix (after), rebuilt like every other photo. */
export const itPhoto = createServerFn({ method: "POST" })
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
    mayUse(a);
    // Readable through the user's own access means they may add photos to it.
    const { data: row } = await context.supabase
      .from("it_tickets" as never)
      .select("id,state")
      .eq("id", data.id)
      .maybeSingle();
    const t = row as unknown as { id: string; state: string } | null;
    if (!t || ["CONFIRMED", "CANCELLED"].includes(t.state))
      throw new DomainError("FORBIDDEN", 403, "لا يمكن إضافة صور لهذه التذكرة");
    const db = await c.admin();
    const { count } = await db
      .from("it_photos" as never)
      .select("id", { count: "exact", head: true })
      .eq("ticket_id", data.id)
      .eq("stage", data.stage);
    if ((count ?? 0) >= MAX_PHOTOS)
      throw new DomainError("FILE_COUNT", 400, `الحد الأعلى ${MAX_PHOTOS} صور`);
    const raw = Uint8Array.from(atob(data.base64), (ch) => ch.charCodeAt(0));
    if (raw.length > 8 * 1024 * 1024)
      throw new DomainError("TOO_LARGE", 400, "يسمح بصور حتى 8 ميغابايت");
    const { cleanPhoto, putEvidence } = await import("./evidence.server");
    const bytes = cleanPhoto(raw);
    const key = `it/${data.id}/${crypto.randomUUID()}`;
    c.rpcError(await putEvidence(key, bytes, "image/jpeg"));
    const { error } = await db.from("it_photos" as never).insert({
      ticket_id: data.id,
      stage: data.stage,
      storage_key: key,
      size: bytes.length,
      uploaded_by: a.id,
    } as never);
    c.rpcError(error);
    await db.from("it_events" as never).insert({
      ticket_id: data.id,
      type: data.stage === "AFTER" ? "PHOTO_AFTER" : "PHOTO_BEFORE",
      actor: a.id,
    } as never);
    return { ok: true };
  });

/** A short-lived link to view one photo. */
export const itPhotoLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    mayUse(a);
    const { data: photo } = await context.supabase
      .from("it_photos" as never)
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
const listItem = (what: string) =>
  z.object({
    id: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    label: z.string().trim().min(2, `اكتب اسم ${what}`).max(60),
    active: z.boolean(),
  });

/** Problem types, departments and deadlines (IT manager and super admin). */
export const itSaveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        categories: z.array(listItem("نوع المشكلة")).min(1).max(60),
        departments: z.array(listItem("القسم")).min(1).max(60),
        sla: z.object({ URGENT: deadline, HIGH: deadline, NORMAL: deadline }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "it.configure");
    for (const p of IT_PRIORITIES)
      if (data.sla[p].fix < data.sla[p].respond)
        throw new DomainError("INVALID_SLA", 400, "مهلة الحل يجب ألا تقل عن مهلة بدء العمل");
    const db = await c.admin();
    const { error } = await db
      .from("app_settings")
      .upsert({ key: "it", value: data as never, updated_at: new Date().toISOString() });
    c.rpcError(error);
    await db.rpc("write_audit", { _actor: a.id, _action: "IT_SETTINGS_UPDATED", _entity: "it" });
    return toItSettings(data);
  });

const reportInput = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    department: z.string().max(40).optional(),
    branchId: z.string().uuid().optional(),
    csv: z.boolean().default(false),
  })
  .refine(
    (v) => v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) / 86400000 < 366,
    "اختر فترة لا تتجاوز 366 يوماً.",
  );

/**
 * Tickets opened in a period (Riyadh time), for the IT report. With csv: one
 * row per ticket, with the department, brand, branch name, code and id.
 */
export const itReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => reportInput.parse(d))
  .handler(async ({ data: q, context }) => {
    const c = await core();
    const a = await c.requireActor(context as never);
    authorize(a, "it.report");
    const start = new Date(q.from + "T00:00:00+03:00").toISOString();
    const end = new Date(Date.parse(q.to + "T00:00:00+03:00") + 86400000).toISOString();
    const rows: Row[] = [];
    for (let off = 0; ; off += 1000) {
      let qb = context.supabase
        .from("it_tickets" as never)
        .select("*")
        .gte("created_at", start)
        .lt("created_at", end);
      if (q.department) qb = qb.eq("department", q.department);
      if (q.branchId) qb = qb.eq("branch_id", q.branchId);
      const { data, error } = await qb.order("created_at").range(off, off + 999);
      if (error) throw new DomainError("LOAD_FAILED", 500, "تعذر تحميل تقرير تقنية المعلومات");
      rows.push(...((data ?? []) as unknown as Row[]));
      if (!data || data.length < 1000) break;
    }
    const tickets = rows.map(toTicket);
    const db = await c.admin();
    const people = await c.staffDirectory(await allBrands());
    const names = Object.fromEntries(
      people
        .filter((p) => tickets.some((t) => t.requester === p.id || t.assignee === p.id))
        .map((p) => [p.id, p.name]),
    );
    if (!q.csv) return { tickets, names, csv: null };

    const branchIds = [...new Set(tickets.map((t) => t.branchId).filter(Boolean))] as string[];
    const [{ data: branches }, { data: brands }, settings] = await Promise.all([
      db
        .from("branches")
        .select("id,name,code,city")
        .in("id", branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"]),
      db.from("brands").select("id,name"),
      loadSettings(),
    ]);
    const branchOf = (id: string | null) => (id ? branches?.find((b) => b.id === id) : undefined);
    const brandName = (id: string | null) =>
      id ? (brands?.find((b) => b.id === id)?.name ?? id) : "";
    const department = (id: string) => settings.departments.find((d) => d.id === id)?.label ?? id;
    const person = (id: string | null) => (id ? (names[id] ?? "موظف") : "");
    const riyadh = (iso: string | null) =>
      iso
        ? new Date(+new Date(iso) + 3 * 3600000).toISOString().slice(0, 16).replace("T", " ")
        : "";
    const hours = (from: string, to: string | null) =>
      to ? ((+new Date(to) - +new Date(from)) / 3600000).toFixed(1) : "";
    const header = [
      "رقم التذكرة",
      "القسم",
      "العلامة",
      "الفرع",
      "رمز الفرع",
      "معرّف الفرع",
      "نوع المشكلة",
      "العنوان",
      "الأولوية",
      "الحالة",
      "متأخرة",
      "مقدم الطلب",
      "المختص",
      "تاريخ الفتح",
      "بدء العمل",
      "تم الحل",
      "تأكيد مقدم الطلب",
      "ساعات حتى الحل",
      "مهلة الحل",
    ];
    const lines = tickets.map((t) => {
      const b = branchOf(t.branchId);
      const late = itLate(t);
      const solvedLate = t.doneAt && t.fixDueAt && +new Date(t.doneAt) > +new Date(t.fixDueAt);
      return [
        itNumber(t.number),
        department(t.department),
        brandName(t.brandId),
        b?.name ?? "",
        b?.code ?? "",
        t.branchId ?? "",
        itCategoryText(t, settings.categories),
        t.title,
        itPriorityLabels[t.priority],
        itStateLabels[t.state],
        late || solvedLate ? "نعم" : "لا",
        person(t.requester),
        person(t.assignee),
        riyadh(t.createdAt),
        riyadh(t.startedAt),
        riyadh(t.doneAt),
        riyadh(t.confirmedAt),
        hours(t.createdAt, t.doneAt),
        riyadh(t.fixDueAt),
      ];
    });
    const csv = "﻿" + [header, ...lines].map((row) => row.map(safeCell).join(",")).join("\r\n");
    await db.rpc("write_audit", {
      _actor: a.id,
      _action: "IT_REPORT_EXPORTED",
      _entity: `${q.from}..${q.to}`,
    });
    return { tickets, names, csv };
  });
