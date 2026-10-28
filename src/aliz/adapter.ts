// Connects the original Aliz Globe screens (which call a REST API by path) to
// this project's backend: TanStack server functions for every write and for
// reads that decrypt, and RLS-scoped Supabase selects for plain scoped reads.
// The screens keep their original markup and behaviour; only data access
// changes here. Paths with no backend yet fail with a clear Arabic message.
import { supabase } from "@/integrations/supabase/client";
import {
  complaintAction,
  createPhoneComplaint,
  getBootstrap,
  getComplaint,
  searchComplaints,
} from "@/functions/complaints.functions";
import { listRefunds, refundAction, requestRefund } from "@/functions/refunds.functions";
import {
  cancelShift,
  createStaff,
  evidenceLink,
  listQrs,
  listShifts,
  listStaff,
  qrForBranch,
  retireQr,
  runReport,
  saveBranch,
  saveShifts,
  setBranchActive,
  updateBrand,
  updateSetting,
  updateStaff,
  uploadEvidence,
} from "@/functions/admin.functions";
import {
  publicAttach,
  publicCreate,
  publicQrInfo,
  trackStatus,
} from "@/functions/public.functions";
import { prepareImage } from "./prepare-image";
import { aggregateReport, previousReportPeriod, summarize } from "./report-aggregate";
import type { Brand, Branch, Data, Refund, Shift, Ticket, User } from "./types";

/** Thrown when the account needs two-factor, has no role yet, or is disabled. */
export class AccessError extends Error {
  constructor(
    public code: "MFA_REQUIRED" | "NO_ACCESS" | "DISABLED",
    message: string,
  ) {
    super(message);
  }
}

const NOT_YET = "هذه الميزة غير مفعلة بعد في هذا الإصدار.";
const logoFiles: Record<string, string> = {
  waqf: "waqf.jpeg",
  kabab: "kabab.png",
  batatisyon: "batatisyon.jpeg",
  mazmuzil: "mazmuzil.webp",
  shawarman: "shawarman.webp",
  aliz: "aliz.webp",
};
const logoFile = (logo: string) => logoFiles[logo] ?? (logo.includes(".") ? logo : "neutral.svg");

type Row = Record<string, unknown>;
type BootstrapOk = Extract<Awaited<ReturnType<typeof getBootstrap>>, { status: "OK" }>;

let directory: { brands: Brand[]; branches: Branch[] } = { brands: [], branches: [] };
let qrCache: { id: string; branchId: string }[] = [];

function toBranch(b: Row): Branch {
  return {
    id: String(b["id"]),
    brandId: String(b["brand_id"]),
    name: String(b["name"]),
    city: String(b["city"] ?? ""),
    district: (b["district"] as string) ?? null,
    address: (b["address"] as string) ?? null,
    mapsUrl: (b["maps_url"] as string) ?? null,
    latitude: (b["latitude"] as number) ?? null,
    longitude: (b["longitude"] as number) ?? null,
    phone: (b["phone"] as string) ?? null,
    code: String(b["code"] ?? ""),
    active: !!b["active"],
    demo: false,
  };
}
function toDirectory(brands: Row[], branches: Row[]) {
  const all = branches.map(toBranch);
  return {
    branches: all,
    brands: brands.map((b) => ({
      id: String(b["id"]),
      name: String(b["name"]),
      nameEn: String(b["name_en"] ?? ""),
      logo: logoFile(String(b["logo"])),
      color: String(b["color"]),
      status: String(b["status"]),
      branches: all.filter((x) => x.brandId === b["id"]),
    })),
  };
}
const brandOf = (id: string) =>
  directory.brands.find((b) => b.id === id) ??
  ({
    id,
    name: id,
    nameEn: "",
    logo: "neutral.svg",
    color: "#6f645e",
    status: "DRAFT",
    branches: [],
  } as Brand);
const branchOf = (id: string | null) =>
  id ? (directory.branches.find((b) => b.id === id) ?? null) : null;

type ListTicket = Awaited<ReturnType<typeof searchComplaints>>["tickets"][number];
type Timer = {
  ticket_id: string;
  milestone: string;
  due_at: string;
  warning_at: string;
  completed_at: string | null;
  breached_at: string | null;
};
const toTimer = (t: Timer) => ({
  id: `${t.ticket_id}:${t.milestone}`,
  milestone: t.milestone,
  dueAt: t.due_at,
  warningAt: t.warning_at,
  completedAt: t.completed_at,
  breachedAt: t.breached_at,
});

function toTicket(t: ListTicket, timers: Timer[] = []): Ticket {
  return {
    ...(t as unknown as Ticket),
    description: t.description ?? "",
    branchBrief: t.branchBrief ?? null,
    customer: t.customer ?? null,
    brand: brandOf(t.brandId),
    branch: branchOf(t.branchId),
    events: [],
    timers: timers.filter((x) => x.ticket_id === t.id).map(toTimer),
    refunds: [],
    tasks: [],
    attachments: [],
    reviews: [],
  };
}

async function allTickets(limit = 500) {
  const out: ListTicket[] = [];
  let offset: number | null = 0,
    total = 0;
  while (offset !== null && out.length < limit) {
    const page: Awaited<ReturnType<typeof searchComplaints>> = await searchComplaints({
      data: { filter: "all", q: "", offset },
    });
    out.push(...page.tickets);
    total = page.total;
    offset = page.nextOffset;
  }
  return { tickets: out, total };
}
async function timersFor(ids: string[]) {
  const rows: Timer[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("ticket_timers")
      .select("*")
      .in("ticket_id", ids.slice(i, i + 200));
    rows.push(...((data ?? []) as Timer[]));
  }
  return rows;
}

type LovableRefund = Awaited<ReturnType<typeof listRefunds>>[number];
function toRefund(r: LovableRefund, tickets: Ticket[], files: Row[]): Refund {
  const linked = r.ticketId ? tickets.find((t) => t.id === r.ticketId) : null;
  return {
    ...(r as unknown as Refund),
    brand: brandOf(r.brandId),
    branch: branchOf(r.branchId),
    updatedAt: r.createdAt,
    ticket: r.ticketId ? { id: r.ticketId, number: linked?.number ?? "" } : null,
    attachments: files
      .filter((f) => f["refund_id"] === r.id)
      .map((f) => ({ id: String(f["id"]), status: String(f["status"]) })),
  };
}
const toShift = (s: Row): Shift => ({
  id: String(s["id"]),
  userId: String(s["user_id"]),
  brandId: null,
  version: Number(s["version"]),
  cancelledAt: (s["cancelled_at"] as string) ?? null,
  start: String(s["start_at"]),
  end: String(s["end_at"]),
  breakStart: (s["break_start"] as string) ?? null,
  breakEnd: (s["break_end"] as string) ?? null,
  lead: !!s["lead"],
  dayOff: !!s["day_off"],
});

async function bootstrap(): Promise<Data> {
  const boot = await getBootstrap();
  if (boot.status === "MFA_REQUIRED") throw new AccessError("MFA_REQUIRED", "يلزم التحقق بخطوتين");
  if (boot.status === "DISABLED") throw new AccessError("DISABLED", "الحساب موقوف");
  if (boot.status !== "OK") throw new AccessError("NO_ACCESS", "لا توجد صلاحية مسندة لهذا الحساب");
  const b = boot as BootstrapOk;
  directory = toDirectory(b.brands as Row[], b.branches as Row[]);
  const from = new Date(Date.now() - 14 * 86400000).toISOString(),
    to = new Date(Date.now() + 56 * 86400000).toISOString();
  const [{ tickets, total }, refunds, shifts] = await Promise.all([
    allTickets(),
    b.permissions.includes("read") ? listRefunds() : Promise.resolve([] as LovableRefund[]),
    listShifts({ data: { from, to } }).catch(() => [] as Row[]),
  ]);
  const timers = await timersFor(tickets.map((t) => t.id));
  const mapped = tickets.map((t) => toTicket(t, timers));
  const { data: refundFiles } = refunds.length
    ? await supabase
        .from("attachments")
        .select("id,refund_id,status")
        .in(
          "refund_id",
          refunds.map((r) => r.id),
        )
    : { data: [] as Row[] };
  return {
    authMode: "password",
    me: { ...(b.me as unknown as User), branchIds: b.me!.branchIds ?? [] },
    demo: false,
    brands: directory.brands,
    users: b.staff as User[],
    tickets: mapped,
    ticketCount: total,
    refunds: refunds.map((r) => toRefund(r, mapped, (refundFiles ?? []) as Row[])),
    tasks: [],
    shifts: (shifts as Row[]).map(toShift),
    leave: [],
    permissions: b.permissions,
    integrations: { whatsapp: b.flags.whatsapp },
    policy: {
      sla: b.flags.slaVersion,
      finance: b.flags.financeApproved,
      publicIntake: b.flags.publicIntake,
    },
  };
}

async function ticketDetail(id: string): Promise<Ticket> {
  const d = await getComplaint({ data: { id } });
  if (!d) throw new Error("الشكوى غير متاحة ضمن صلاحيات حسابك.");
  const t = toTicket(d.ticket as ListTicket);
  return {
    ...t,
    events: d.events.map((e) => ({ ...e, note: e.note ?? null })),
    timers: (d.timers as Timer[]).map(toTimer),
    refunds: d.refunds as unknown as Refund[],
    attachments: d.attachments.map((f) => ({ id: f.id, status: f.status })),
  };
}

const ticketActions: Record<string, string> = { acknowledge: "start", confirm: "contact" };
async function ticketAction(id: string, action: string, body: Row) {
  const mapped = ticketActions[action] ?? action;
  return complaintAction({
    data: {
      id,
      action: mapped as never,
      input: {
        version: Number(body["version"]),
        note: body["note"] ?? (mapped === "contact" ? "تم التواصل مع العميل" : ""),
        resolutionOwner: body["resolutionOwner"] || undefined,
        outcome: body["outcome"] || undefined,
        branchBrief: body["branchBrief"] || undefined,
      },
    },
  });
}

const toBase64 = async (file: Blob) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
async function upload(
  owner: { ticketId?: string; refundId?: string },
  body: BodyInit | null | undefined,
) {
  const files = body instanceof FormData ? (body.getAll("files") as File[]) : [];
  if (!files.length) throw new Error("اختر صورة واحدة على الأقل");
  for (const f of files) {
    const prepared = await prepareImage(f);
    await uploadEvidence({
      data: { ...owner, mime: prepared.type || f.type, base64: await toBase64(prepared) },
    });
  }
  return { ok: true };
}

/** Photos from the QR form, authorized by the new complaint's tracking link. */
async function publicUpload(token: string, body: BodyInit | null | undefined) {
  const files = body instanceof FormData ? (body.getAll("files") as File[]) : [];
  if (!files.length) throw new Error("اختر صورة واحدة على الأقل");
  if (!token) throw new Error("انتهت جلسة إرفاق الصور");
  for (const f of files)
    await publicAttach({ data: { token, base64: await toBase64(await prepareImage(f)) } });
  return { ok: true };
}

const num = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : Number(v));
const branchFields = (b: Row) => ({
  brandId: String(b["brandId"]),
  name: String(b["name"] ?? ""),
  code: String(b["code"] ?? ""),
  city: String(b["city"] ?? ""),
  district: (b["district"] as string) || null,
  address: (b["address"] as string) || null,
  mapsUrl: (b["mapsUrl"] as string) || null,
  latitude: num(b["latitude"]) ?? null,
  longitude: num(b["longitude"]) ?? null,
  phone: (b["phone"] as string) || null,
});
const staffFields = (b: Row) => ({
  name: String(b["name"] ?? ""),
  role: b["role"] as never,
  financeDuty: ((b["financeDuty"] as string) || "NONE") as never,
  brandIds: (b["brandIds"] as string[]) ?? [],
  branchIds: (b["branchIds"] as string[]) ?? [],
});
const shiftEntry = (b: Row) => ({
  userId: String(b["userId"]),
  start: new Date(String(b["start"])).toISOString(),
  end: new Date(String(b["end"])).toISOString(),
  breakStart: b["breakStart"] ? new Date(String(b["breakStart"])).toISOString() : null,
  breakEnd: b["breakEnd"] ? new Date(String(b["breakEnd"])).toISOString() : null,
  lead: !!b["lead"],
  dayOff: !!b["dayOff"],
});

async function report(params: URLSearchParams) {
  const q = Object.fromEntries([...params].filter(([, v]) => v)) as Record<string, string>;
  const rowsFor = async (from: string, to: string) => {
    const start = new Date(from + "T00:00:00+03:00").toISOString(),
      end = new Date(Date.parse(to + "T00:00:00+03:00") + 86400000).toISOString();
    const out: Row[] = [];
    for (let off = 0; ; off += 1000) {
      let qb = supabase
        .from("tickets")
        .select(
          "brand_id,branch_id,state,source,category,priority,escalated,resolution_owner,received_at,closed_at",
        )
        .gte("received_at", start)
        .lt("received_at", end);
      if (q["brandId"]) qb = qb.eq("brand_id", q["brandId"]);
      if (q["branchId"]) qb = qb.eq("branch_id", q["branchId"]);
      if (q["source"]) qb = qb.eq("source", q["source"] as never);
      if (q["priority"]) qb = qb.eq("priority", q["priority"] as never);
      const { data, error } = await qb.order("received_at").range(off, off + 999);
      if (error) throw new Error("تعذر تحميل التقرير");
      out.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    return out.map((r) => {
      const brand = brandOf(String(r["brand_id"])),
        branch = branchOf(r["branch_id"] as string | null);
      return {
        brandId: String(r["brand_id"]),
        branchId: (r["branch_id"] as string) ?? null,
        state: String(r["state"]),
        source: String(r["source"]),
        category: String(r["category"]),
        priority: String(r["priority"]),
        escalated: !!r["escalated"],
        resolutionOwner: (r["resolution_owner"] as string) ?? null,
        receivedAt: new Date(String(r["received_at"])),
        closedAt: r["closed_at"] ? new Date(String(r["closed_at"])) : null,
        brand: { name: brand.name, logo: brand.logo, color: brand.color },
        branch: branch ? { name: branch.name } : null,
      };
    });
  };
  const input = { from: q["from"] ?? "", to: q["to"] ?? "" };
  if (!input.from || !input.to) throw new Error("اختر فترة التقرير");
  const previous = previousReportPeriod(input),
    now = new Date();
  const [rows, previousRows, staff] = await Promise.all([
    rowsFor(input.from, input.to),
    rowsFor(previous.from, previous.to),
    getBootstrap().then((b) => (b.status === "OK" ? (b as BootstrapOk).staff : [])),
  ]);
  const result = aggregateReport(rows, input.from, input.to, now);
  return {
    ...result,
    team: result.team.map((t) => ({
      ...t,
      name:
        t.id === "UNASSIGNED"
          ? "غير مسند"
          : (staff.find((u) => u.id === t.id)?.name ?? "موظف سابق"),
    })),
    previous: {
      from: previous.from,
      to: previous.to,
      summary: summarize(previousRows),
      trend: aggregateReport(previousRows, previous.from, previous.to, now).trend,
    },
    filters: q,
    generatedAt: now.toISOString(),
  };
}

/** CSV download for the reports page (masked, audited by the server). */
export async function downloadReport(query: string) {
  const q = Object.fromEntries(new URLSearchParams(query)) as Record<string, string>;
  const out = await runReport({
    data: {
      from: q["from"],
      to: q["to"],
      brandId: q["brandId"] || undefined,
      source: (q["source"] || undefined) as never,
      priority: (q["priority"] || undefined) as never,
      csv: true,
    },
  });
  const csv = (out as { csv?: string }).csv ?? "";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "aliz-complaints.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** Short-lived signed link for a scanned photo; null while the scan is pending. */
export async function evidenceUrl(id: string) {
  const { url } = await evidenceLink({ data: { id } });
  return url;
}

async function route(
  method: string,
  path: string,
  body: Row,
  extra?: RequestInit,
): Promise<unknown> {
  const [p = "", query = ""] = path.split("?");
  const s = p.split("/");
  const at = (i: number) => s[i] ?? "";
  const params = new URLSearchParams(query);
  const is = (...parts: string[]) =>
    parts.length === s.length && parts.every((x, i) => x === "*" || x === s[i]);

  // Session
  if (is("auth", "options")) return { mode: "password", available: true };
  if (is("login")) {
    const { error } = await supabase.auth.signInWithPassword({
      email: String(body["email"]),
      password: String(body["password"]),
    });
    if (error) throw new Error("بيانات الدخول غير صحيحة");
    return { ok: true };
  }
  if (is("logout")) {
    await supabase.auth.signOut();
    return { ok: true };
  }
  if (is("bootstrap")) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("يرجى تسجيل الدخول");
    return bootstrap();
  }

  // Complaints
  if (is("tickets", "search")) {
    const filter = params.get("filter") || "all";
    const allowed = ["all", "open", "working", "contact", "waiting", "escalated", "closed", "mine"];
    const r = await searchComplaints({
      data: {
        q: params.get("q") ?? "",
        brandId: params.get("brandId") || undefined,
        filter: (allowed.includes(filter) ? filter : "all") as never,
        offset: Number(params.get("offset") ?? 0),
      },
    });
    const timers = await timersFor(r.tickets.map((t) => t.id));
    return { ...r, tickets: r.tickets.map((t) => toTicket(t, timers)) };
  }
  if (is("tickets", "phone")) {
    const key = String(
      (extra?.headers as Record<string, string>)?.["Idempotency-Key"] ?? crypto.randomUUID(),
    );
    const input = {
      ...body,
      priority: body["priority"] || "P3",
      whatsappConsent: !!body["whatsappConsent"],
    };
    return createPhoneComplaint({ data: { key, input } });
  }
  if (is("tickets", "*", "actions", "*")) return ticketAction(at(1), at(3), body);
  if (is("tickets", "*", "attachments")) return upload({ ticketId: at(1) }, extra?.body);
  if (is("tickets", "*") && method === "GET") return ticketDetail(at(1));
  if (is("customers", "search")) {
    const r = await searchComplaints({
      data: { q: String(body["phone"] ?? ""), filter: "all", offset: 0 },
    });
    return r.tickets.map((t) => ({ ...toTicket(t), number: t.number }));
  }

  // Refunds
  if (is("refunds") && method === "POST")
    return requestRefund({
      data: {
        ticketId: (body["ticketId"] as string) || undefined,
        brandId: (body["brandId"] as string) || undefined,
        branchId: (body["branchId"] as string) || null,
        externalOrder: (body["externalOrder"] as string) || undefined,
        platform: (body["platform"] as string) || undefined,
        kind: (body["kind"] as never) ?? "REFUND",
        reason: String(body["reason"] ?? ""),
        amountMinor: num(body["amountMinor"]),
      },
    });
  if (is("refunds", "*", "evidence", "images")) return upload({ refundId: at(1) }, extra?.body);
  if (is("refunds", "*", "*"))
    return refundAction({
      data: {
        id: at(1),
        action: at(2) as never,
        version: Number(body["version"]),
        note: String(body["note"] ?? ""),
        reference: (body["reference"] as string) || undefined,
        proofId: (body["proofId"] as string) || undefined,
        reason: (body["reason"] as string) || undefined,
        amountMinor: num(body["amountMinor"]),
      },
    });

  // Directory and QR
  if (is("brands", "*", "status"))
    return updateBrand({ data: { id: at(1), status: body["status"] as never } });
  if (is("brands", "*") && method === "POST")
    return updateBrand({ data: { id: at(1), name: String(body["name"] ?? "") || undefined } });
  if (is("branches") && method === "POST")
    return saveBranch({ data: { fields: branchFields(body) } });
  if (is("branches", "*", "status"))
    return setBranchActive({ data: { id: at(1), active: !!body["active"] } });
  if (is("branches", "*") && method === "POST")
    return saveBranch({ data: { id: at(1), fields: branchFields(body) } });
  if (is("qrs") && method === "GET") {
    const list = await listQrs();
    qrCache = list.map((q) => ({ id: q.id, branchId: q.branchId }));
    return list.map((q) => ({
      ...q,
      placement: "استلام الطلبات",
      active: true,
      revokedAt: null,
      reusable: true,
    }));
  }
  if (is("qrs") && method === "POST")
    return qrForBranch({
      data: { branchId: String(body["branchId"]), origin: window.location.origin },
    });
  if (is("qrs", "*", "link")) {
    const branchId = qrCache.find((q) => q.id === at(1))?.branchId;
    if (!branchId) throw new Error("حدّث القائمة ثم أعد المحاولة");
    return qrForBranch({ data: { branchId, origin: window.location.origin } });
  }
  if (is("qrs", "*", "*")) {
    const branchId = qrCache.find((q) => q.id === at(1))?.branchId;
    await retireQr({ data: { id: at(1), rotate: at(2) === "rotate" } });
    if (at(2) === "rotate" && branchId)
      return qrForBranch({ data: { branchId, origin: window.location.origin } });
    return { ok: true };
  }

  // Staff
  if (is("users") && method === "GET") {
    const rows = await listStaff();
    return rows.map((u) => ({
      id: u.user_id,
      name: u.name,
      email: u.email,
      role: u.role,
      financeDuty: u.finance_duty,
      brandIds: u.brand_ids,
      branchIds: u.branch_ids,
      active: u.enabled,
      createdAt: u.created_at,
    }));
  }
  if (is("users") && method === "POST")
    return createStaff({
      data: {
        ...staffFields(body),
        email: String(body["email"]),
        password: String(body["password"]),
      },
    });
  if (is("users", "*", "status")) {
    const u = (await listStaff()).find((x) => x.user_id === at(1));
    if (!u) throw new Error("المستخدم غير موجود");
    return updateStaff({
      data: {
        userId: at(1),
        name: u.name,
        role: u.role as never,
        financeDuty: u.finance_duty as never,
        brandIds: u.brand_ids,
        branchIds: u.branch_ids,
        enabled: !!body["active"],
      },
    });
  }
  if (is("users", "*") && method === "POST")
    return updateStaff({
      data: { ...staffFields(body), userId: at(1), enabled: body["active"] !== false },
    });

  // Schedule
  if (is("shifts")) return saveShifts({ data: { entries: [shiftEntry(body)] } });
  if (is("shifts", "bulk"))
    return saveShifts({
      data: { entries: ((body["entries"] ?? body["shifts"]) as Row[]).map(shiftEntry) },
    });
  if (is("shifts", "*", "cancel"))
    return cancelShift({ data: { id: at(1), version: Number(body["version"]) } });
  if (is("shifts", "*", "update")) {
    await cancelShift({ data: { id: at(1), version: Number(body["version"]) } });
    return saveShifts({ data: { entries: [shiftEntry(body)] } });
  }

  // Settings (super admin; the server authorizes and audits)
  if (is("settings", "public-intake"))
    return updateSetting({ data: { key: "public_intake_enabled", value: !!body["enabled"] } });

  // Reports
  if (is("reports")) return report(params);

  // Public QR form and tracking (no staff session)
  if (is("public", "q", "*") && method === "GET") {
    const info = await publicQrInfo({ data: { code: at(2) } });
    if (!info.ok) throw new Error(info.message);
    return {
      brand: info.brandName,
      branch: info.branchName,
      logo: logoFile(info.logo),
      demo: false,
      whatsappAvailable: false,
    };
  }
  if (is("public", "q", "*")) {
    const key = String(
      (extra?.headers as Record<string, string>)?.["Idempotency-Key"] ?? crypto.randomUUID(),
    );
    const res = await publicCreate({
      data: {
        code: at(2),
        key,
        input: {
          description: String(body["description"] ?? ""),
          category: String(body["category"] ?? "OTHER"),
          name: (body["name"] as string) || undefined,
          phone: (body["phone"] as string) || undefined,
          externalOrder: (body["externalOrder"] as string) || undefined,
          platform: (body["platform"] as string) || undefined,
          consent: body["consent"] === true ? true : (undefined as never),
        },
      },
    });
    return { id: "", number: res.number, trackingToken: res.trackingToken ?? "" };
  }
  if (is("public", "attachments", "*"))
    return publicUpload(
      String((extra?.headers as Record<string, string> | undefined)?.["x-case-token"] ?? ""),
      extra?.body,
    );
  if (is("public", "status", "*")) {
    const r = await trackStatus({ data: { token: at(2) } });
    if (!r.ok) throw new Error(r.message);
    return {
      number: r.number,
      state: r.state,
      createdAt: r.receivedAt,
      receipt: {
        number: r.number,
        brand: r.brand,
        branch: r.branch,
        receivedAt: r.receivedAt,
        category: r.category,
        description: "",
        customerName: "",
        externalOrder: "",
        platform: "",
        source: "QR",
        trackingPath: "",
      },
    };
  }

  // Not built on this backend yet.
  if (is("integrations", "telegram", "account"))
    return { available: false, linked: false, label: null, pending: null, expiresAt: null };
  if (is("integrations", "telegram") || is("integrations", "whatsapp"))
    return { ready: false, enabled: false, missing: [], statuses: {}, users: [] };
  throw new Error(NOT_YET);
}

/** Same signature as the original fetch-based helper. */
export async function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  extra?: RequestInit,
): Promise<T> {
  const method = body !== undefined ? "POST" : (extra?.method ?? "GET");
  try {
    return (await route(method, path, (body ?? {}) as Row, extra)) as T;
  } catch (e) {
    if (e instanceof AccessError) throw e;
    throw new Error(readable(e));
  }
}

function readable(e: unknown) {
  if (!(e instanceof Error)) return "تعذر الاتصال بالخادم";
  try {
    const parsed = JSON.parse(e.message);
    if (Array.isArray(parsed) && parsed[0]?.message) return String(parsed[0].message);
  } catch {
    /* plain message */
  }
  return e.message || "تعذر الاتصال بالخادم";
}
