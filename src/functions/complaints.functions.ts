import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { authorize, can, normalizePhone, permissionsForRole, refundNumber, ticketNumber } from "@/lib/domain";

const core = () => import("./core.server");
const tickets = () => import("./tickets.server");

export const getBootstrap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await core();
    const state = await c.accessState(context as never);
    const email = (context.claims as { email?: string }).email ?? "";
    if (state.status !== "OK") return { status: state.status, email, me: null };
    const a = state.actor;
    const [{ data: brands }, { data: branches }, staff, s] = await Promise.all([
      context.supabase.from("brands").select("*").order("created_at"),
      context.supabase.from("branches").select("*").order("name"),
      c.staffDirectory(a.role === "SUPER_ADMIN" ? ["waqf", "kabab", "batatisyon", "mazmuzil", "shawarman", ...a.brandIds] : a.brandIds),
      c.settings(),
    ]);
    return {
      status: "OK" as const,
      email,
      me: a,
      permissions: permissionsForRole(a.role, a.financeDuty),
      brands: brands ?? [],
      branches: branches ?? [],
      staff,
      flags: {
        publicIntake: s.publicIntake,
        financeApproved: s.financeApproved,
        financeLimitMinor: s.financeLimitMinor,
        slaVersion: s.sla?.version ?? "PENDING",
        slaApproved: !!s.sla?.approved,
        whatsapp: s.whatsapp,
        telegram: s.telegram,
      },
    };
  });

const searchInput = z.object({
  q: z.string().trim().max(200).default(""),
  brandId: z.string().max(100).optional(),
  filter: z.enum(["all", "open", "working", "contact", "waiting", "escalated", "closed", "mine"]).default("all"),
  offset: z.number().int().min(0).max(1000000).default(0),
});

export const searchComplaints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => searchInput.parse(d))
  .handler(async ({ data: b, context }) => {
    const c = await core();
    const t = await tickets();
    const a = await c.requireActor(context as never);
    authorize(a, "read");
    // RLS on tickets enforces role + brand/branch scope; filters below only narrow it.
    let q = context.supabase.from("tickets").select("*", { count: "exact" });
    if (b.brandId && b.brandId !== "all") q = q.eq("brand_id", b.brandId);
    if (b.filter === "open") q = q.neq("state", "CLOSED");
    if (b.filter === "closed") q = q.eq("state", "CLOSED");
    if (b.filter === "working") q = q.in("state", ["ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS"]);
    if (b.filter === "contact") q = q.eq("state", "RESOLVED");
    if (b.filter === "waiting") q = q.neq("state", "CLOSED").or("state.in.(NEW,TRIAGED),resolution_owner.is.null");
    if (b.filter === "escalated") q = q.eq("escalated", true).neq("state", "CLOSED");
    if (b.filter === "mine") q = q.or(`creator.eq.${a.id},resolution_owner.eq.${a.id},communications_owner.eq.${a.id}`);
    if (b.q) {
      const safe = b.q.replace(/[,()*%\\"]/g, " ").trim();
      const ors: string[] = [];
      if (safe) ors.push(`external_order.ilike.*${safe}*`);
      const { data: br } = await context.supabase.from("branches").select("id").ilike("name", `%${safe}%`);
      if (br?.length) ors.push(`branch_id.in.(${br.map((x) => x.id).join(",")})`);
      const { data: bd } = await context.supabase.from("brands").select("id").ilike("name", `%${safe}%`);
      if (bd?.length) ors.push(`brand_id.in.(${bd.map((x) => x.id).join(",")})`);
      const num = /^AG-(\d{4})-(\d+)$/i.exec(b.q);
      if (num && Number(num[2]) <= 2147483647) ors.push(`sequence.eq.${Number(num[2])}`);
      else if (/^\d{1,9}$/.test(b.q)) ors.push(`sequence.eq.${Number(b.q)}`);
      // Matching a customer's phone reveals who complained, so only roles with customer-data access may search by it.
      const phone = normalizePhone(b.q);
      if (can(a, "pii") && /^9665\d{8}$/.test(phone)) {
        const { keyedHash } = await import("./crypto.server");
        ors.push(`phone_hash.eq.${await keyedHash("phone:" + phone)}`);
      }
      if (!ors.length) return { tickets: [], total: 0, nextOffset: null };
      q = q.or(ors.join(","));
    }
    const { data, count, error } = await q
      .order("received_at", { ascending: false })
      .order("id", { ascending: false })
      .range(b.offset, b.offset + 49);
    if (error) throw error;
    const db = await c.admin();
    await db.rpc("write_audit", { _actor: a.id, _action: "SCOPED_COMPLAINT_SEARCH", _entity: b.brandId ?? "SCOPED" });
    const list = await Promise.all((data ?? []).map((row) => t.presentTicket(row as never, a)));
    const total = count ?? 0;
    return { tickets: list, total, nextOffset: b.offset + list.length < total ? b.offset + list.length : null };
  });

export const getComplaint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const t = await tickets();
    const a = await c.requireActor(context as never);
    authorize(a, "read");
    const { data: row } = await context.supabase.from("tickets").select("*").eq("id", data.id).maybeSingle();
    if (!row) return null;
    const { decrypt } = await import("./crypto.server");
    const [{ data: events }, { data: timers }, { data: refunds }, { data: files }] = await Promise.all([
      context.supabase.from("ticket_events").select("*").eq("ticket_id", data.id).order("created_at"),
      context.supabase.from("ticket_timers").select("*").eq("ticket_id", data.id),
      context.supabase.from("refunds").select("id,sequence,created_at,status,kind,requester").eq("ticket_id", data.id),
      context.supabase.from("attachments").select("id,mime,size,status,created_at").eq("ticket_id", data.id),
    ]);
    const pii = can(a, "pii");
    const db = await c.admin();
    if (pii) await db.rpc("write_audit", { _actor: a.id, _action: "SCOPED_PII_READ", _entity: data.id });
    return {
      ticket: await t.presentTicket(row as never, a, true),
      events: await Promise.all(
        (events ?? []).map(async (e) => ({
          id: e.id, type: e.type, actor: e.actor, createdAt: e.created_at,
          note: e.note_enc && (pii || e.actor === a.id) ? await decrypt(e.note_enc) : null,
        })),
      ),
      timers: timers ?? [],
      refunds: (refunds ?? [])
        .filter((r) => a.role !== "AGENT" || r.requester === a.id)
        .map((r) => ({ id: r.id, number: refundNumber(r.sequence, r.created_at), status: r.status, kind: r.kind })),
      attachments: can(a, "evidence.view") ? files ?? [] : [],
    };
  });

export const createPhoneComplaint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { key: string; input: unknown }) => z.object({ key: z.string().min(8).max(100), input: z.unknown() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await core();
    const t = await tickets();
    const a = await c.requireActor(context as never);
    return t.createTicketCore(a.id, data.input, data.key, undefined, a);
  });

export const complaintAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; action: string; input: unknown }) =>
    z.object({ id: z.string().uuid(), action: z.enum(["assign", "start", "resolve", "followup", "close", "reopen", "escalate", "comment", "contact"]), input: z.unknown() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await core();
    const t = await tickets();
    const a = await c.requireActor(context as never);
    return t.ticketActionCore(context as never, a, data.id, data.action, data.input);
  });

export { ticketNumber };
