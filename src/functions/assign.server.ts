import { inScope, slaMilestones } from "@/lib/domain";
import { admin, settings } from "./core.server";

/*
 * Automatic assignment of new complaints, following the staff schedule.
 *
 * A complaint goes only to an agent who is on shift right now (not on a break
 * or day off) and covers its brand and branch: the one with the fewest open
 * cases, then fewer complaints in the last 24 hours, then by name, so the
 * order is predictable. When nobody is on shift the complaint waits; every
 * few minutes waiting complaints are offered again (assignWaiting), so the
 * first agent whose shift starts receives them. A complaint that waited has
 * its deadlines counted from when it was assigned, not from when it arrived.
 */

export type Candidate = {
  id: string;
  name: string;
  open: number;
  recent: number;
  onShift: boolean;
};

export function pickAgent(candidates: Candidate[]) {
  const pool = candidates.filter((c) => c.onShift);
  return (
    [...pool].sort(
      (a, b) =>
        a.open - b.open ||
        a.recent - b.recent ||
        a.name.localeCompare(b.name, "ar") ||
        a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

const OPEN = ["NEW", "TRIAGED", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS"];
const WAITED_MS = 3 * 60_000;

/** Assign a newly created complaint. Never throws: the complaint stays for a manager if this fails. */
export async function autoAssign(ticketId: string, now = new Date()) {
  try {
    if (!(await settings()).autoAssign) return null;
    const db = await admin();
    const { data: t } = await db
      .from("tickets")
      .select(
        "id,brand_id,branch_id,state,version,priority,received_at,resolution_owner,sla_policy",
      )
      .eq("id", ticketId)
      .maybeSingle();
    if (!t || t.state !== "NEW" || t.resolution_owner) return null;

    const { data: agents } = await db
      .from("user_roles")
      .select("user_id,name,role,brand_ids,branch_ids,enabled")
      .eq("role", "AGENT")
      .eq("enabled", true);
    const scope = { brandId: t.brand_id, branchId: t.branch_id };
    const eligible = (agents ?? []).filter((a) =>
      inScope(
        {
          id: a.user_id,
          name: a.name,
          role: a.role,
          brandIds: a.brand_ids,
          branchIds: a.branch_ids,
        },
        scope,
      ),
    );
    if (!eligible.length) return null;
    const ids = eligible.map((a) => a.user_id);
    const iso = now.toISOString();
    const [{ data: open }, { data: recent }, { data: shifts }] = await Promise.all([
      db.from("tickets").select("resolution_owner").in("resolution_owner", ids).in("state", OPEN),
      db
        .from("tickets")
        .select("resolution_owner")
        .in("resolution_owner", ids)
        .gte("created_at", new Date(+now - 86400_000).toISOString()),
      db
        .from("shifts")
        .select("user_id,break_start,break_end")
        .in("user_id", ids)
        .lte("start_at", iso)
        .gt("end_at", iso)
        .eq("day_off", false)
        .is("cancelled_at", null),
    ]);
    const count = (rows: { resolution_owner: string | null }[] | null, id: string) =>
      (rows ?? []).filter((r) => r.resolution_owner === id).length;
    const working = new Set(
      (shifts ?? [])
        .filter(
          (s) =>
            !(
              s.break_start &&
              s.break_end &&
              +new Date(s.break_start) <= +now &&
              +now < +new Date(s.break_end)
            ),
        )
        .map((s) => s.user_id),
    );
    const chosen = pickAgent(
      eligible.map((a) => ({
        id: a.user_id,
        name: a.name,
        open: count(open, a.user_id),
        recent: count(recent, a.user_id),
        onShift: working.has(a.user_id),
      })),
    );
    if (!chosen) return null;

    const policy = (t.sla_policy as never) ?? (await settings()).sla;
    // Assigned straight away: only the "start work" deadline is new. After
    // waiting for a shift: every deadline restarts from now.
    const waited = +now - +new Date(t.received_at) > WAITED_MS;
    const timers = slaMilestones(
      t.priority,
      waited ? now : new Date(t.received_at),
      policy,
      now,
    ).filter((m) => waited || m.milestone === "ACKNOWLEDGMENT");
    const { error } = await db.rpc("apply_ticket_action", {
      _id: t.id,
      _version: t.version,
      p: {
        state: "ASSIGNED",
        resolution_owner: chosen.id,
        communications_owner: chosen.id,
        escalated: false,
        acknowledged_at: null,
      } as never,
      _events: [{ type: "AUTO_ASSIGNED" }] as never,
      _timers: timers.map((m) => ({ op: "upsert", ...m })) as never,
      _actor: "SYSTEM",
    });
    return error ? null : chosen.id;
  } catch {
    return null;
  }
}

/**
 * Offer waiting complaints (new, unassigned) to whoever is on shift now,
 * oldest first. Run every few minutes. Returns how many were assigned.
 */
export async function assignWaiting(now = new Date()) {
  if (!(await settings()).autoAssign) return 0;
  const db = await admin();
  const { data } = await db
    .from("tickets")
    .select("id")
    .eq("state", "NEW")
    .is("resolution_owner", null)
    .order("received_at", { ascending: true })
    .limit(50);
  let assigned = 0;
  for (const t of data ?? []) {
    const who = await autoAssign(t.id, now);
    if (!who) continue;
    assigned++;
    const tg = await import("./telegram.server");
    await tg.notifyAssigned(t.id, who);
  }
  return assigned;
}
