import { inScope, slaMilestones } from "@/lib/domain";
import { admin, settings } from "./core.server";

/*
 * Automatic assignment of new complaints.
 *
 * Each new complaint goes to the agent with the fewest open cases (assigned to
 * them and not yet resolved or closed) among agents covering that brand and
 * branch. Agents on shift right now (not on a break or day off) are preferred;
 * if nobody is on shift, every eligible agent is considered so no complaint is
 * left without an owner. Ties go to the agent who received fewer complaints in
 * the last 24 hours, then by name, so the order is predictable.
 */

export type Candidate = {
  id: string;
  name: string;
  open: number;
  recent: number;
  onShift: boolean;
};

export function pickAgent(candidates: Candidate[]) {
  const pool = candidates.some((c) => c.onShift) ? candidates.filter((c) => c.onShift) : candidates;
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
    const ack = slaMilestones(t.priority, new Date(t.received_at), policy, now).find(
      (m) => m.milestone === "ACKNOWLEDGMENT",
    )!;
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
      _timers: [{ op: "upsert", ...ack }] as never,
      _actor: "SYSTEM",
    });
    return error ? null : chosen.id;
  } catch {
    return null;
  }
}
