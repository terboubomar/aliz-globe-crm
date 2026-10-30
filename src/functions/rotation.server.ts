import { DomainError } from "@/lib/domain";
import { type RotationPlan, coverage, defaultPlan, weekEntries } from "@/lib/rotation";
import { addDays, riyadhDay, riyadhISO, weekDays } from "@/aliz/schedule-time";
import { admin, rpcError } from "./core.server";

type StoredPlan = RotationPlan & { updatedBy?: string };
const PLAN = "schedule_rotation";
const DONE = "schedule_generated_weeks";

const nextSunday = (now = new Date()) => weekDays(1, now)[0]!;

export async function loadPlan(): Promise<StoredPlan> {
  const db = await admin();
  const { data } = await db.from("app_settings").select("value").eq("key", PLAN).maybeSingle();
  return (data?.value as StoredPlan | undefined) ?? defaultPlan(nextSunday());
}

async function generatedWeeks(): Promise<string[]> {
  const db = await admin();
  const { data } = await db.from("app_settings").select("value").eq("key", DONE).maybeSingle();
  return Array.isArray(data?.value) ? (data.value as string[]) : [];
}

export async function savePlan(plan: RotationPlan, actorId: string) {
  const db = await admin();
  if (plan.members.length) {
    const { data: staff } = await db
      .from("user_roles")
      .select("user_id")
      .in("user_id", plan.members)
      .eq("enabled", true);
    if ((staff ?? []).length !== new Set(plan.members).size)
      throw new DomainError("INVALID_STAFF", 400, "أحد الموظفين في التدوير غير متاح أو موقوف");
  }
  if (plan.enabled && !plan.members.length)
    throw new DomainError(
      "NO_MEMBERS",
      400,
      "اختر موظفاً واحداً على الأقل قبل تفعيل التدوير التلقائي",
    );
  const value = { ...plan, updatedBy: actorId };
  const { error } = await db
    .from("app_settings")
    .upsert({ key: PLAN, value: value as never, updated_at: new Date().toISOString() });
  rpcError(error);
  await db.rpc("write_audit", { _actor: actorId, _action: "ROTATION_PLAN_SAVED", _entity: PLAN });
  return value;
}

/** What the rotation would put in a week, leaving days that already have something alone. */
export async function previewWeek(plan: RotationPlan, sunday: string) {
  const db = await admin();
  const { data: existing } = await db
    .from("shifts")
    .select("user_id,start_at,end_at")
    .in("user_id", plan.members.length ? plan.members : ["00000000-0000-0000-0000-000000000000"])
    .is("cancelled_at", null)
    .lt("start_at", riyadhISO(addDays(sunday, 8)))
    .gt("end_at", riyadhISO(addDays(sunday, -1)));
  const busy = (userId: string, from: string, to: string) =>
    (existing ?? []).some(
      (s) =>
        s.user_id === userId &&
        Date.parse(s.start_at) < Date.parse(to) &&
        Date.parse(s.end_at) > Date.parse(from),
    );
  return { ...weekEntries(plan, sunday, busy), coverage: coverage(plan, sunday) };
}

export async function generateWeek(plan: StoredPlan, sunday: string, actorId: string) {
  // A template plan has no shift patterns; it carries its own times.
  if (!plan.members.length || (!plan.shifts.length && !plan.template))
    return { saved: 0, skipped: 0, notified: 0 };
  const { entries, skipped } = await previewWeek(plan, sunday);
  const db = await admin();
  let saved = 0;
  for (let i = 0; i < entries.length; i += 200) {
    const chunk = entries.slice(i, i + 200);
    const { data: n, error } = await db.rpc("save_shifts_tx", {
      _actor: actorId,
      _entries: chunk.map((e) => ({
        user_id: e.userId,
        start_at: e.start,
        end_at: e.end,
        break_start: e.breakStart,
        break_end: e.breakEnd,
        lead: e.lead,
        day_off: e.dayOff,
      })) as never,
    });
    rpcError(error);
    saved += Number(n ?? 0);
  }
  const done = await generatedWeeks();
  if (!done.includes(sunday))
    await db.from("app_settings").upsert({
      key: DONE,
      value: [...done, sunday].slice(-60) as never,
      updated_at: new Date().toISOString(),
    });
  await db.rpc("write_audit", {
    _actor: actorId,
    _action: "ROTATION_WEEK_GENERATED",
    _entity: sunday,
  });
  // A new schedule for this week or next week goes straight to the team on Telegram.
  let notified = 0;
  if (sunday <= weekDays(1)[0]!)
    try {
      notified = (await (await import("./telegram.server")).sendWeek(sunday, "auto")).sent;
    } catch {
      /* the schedule is saved either way */
    }
  return { saved, skipped: skipped.length, notified };
}

/**
 * Clears the plan's people from a week onward so a new plan can replace the old
 * one: their shifts and days off starting from that Sunday (never before now)
 * through the weeks that may already be prepared are cancelled, and those weeks
 * are marked as not yet generated. Past shifts are never touched.
 */
export async function clearFrom(
  plan: StoredPlan,
  sunday: string,
  actorId: string,
  now = new Date(),
) {
  const db = await admin();
  const from = new Date(Math.max(Date.parse(riyadhISO(sunday)), +now)).toISOString();
  const to = riyadhISO(addDays(sunday, 7 * 5));
  const { data: rows, error } = await db
    .from("shifts")
    .update({ cancelled_at: new Date().toISOString() })
    .in("user_id", plan.members)
    .is("cancelled_at", null)
    .gte("start_at", from)
    .lt("start_at", to)
    .select("id");
  rpcError(error);
  const done = await generatedWeeks();
  await db.from("app_settings").upsert({
    key: DONE,
    value: done.filter((d) => d < sunday) as never,
    updated_at: new Date().toISOString(),
  });
  await db.rpc("write_audit", {
    _actor: actorId,
    _action: "ROTATION_SCHEDULE_REPLACED",
    _entity: sunday,
  });
  return rows?.length ?? 0;
}

/**
 * Keep the next few weeks scheduled. Runs on sign-in and from the scheduled
 * run; each week is generated once, so shifts a manager removes stay removed.
 */
export async function ensureUpcoming(now = new Date()) {
  try {
    const plan = await loadPlan();
    if (!plan.enabled || !plan.updatedBy) return 0;
    const done = await generatedWeeks();
    let weeks = 0;
    for (let w = 1; w <= Math.min(Math.max(plan.weeksAhead, 1), 4); w++) {
      const sunday = weekDays(w, now)[0]!;
      if (done.includes(sunday) || sunday < plan.anchor) continue;
      await generateWeek(plan, sunday, plan.updatedBy);
      weeks++;
    }
    return weeks;
  } catch {
    return 0;
  }
}

export const isSunday = (day: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T12:00:00Z`).getUTCDay() === 0;
export const thisSunday = (now = new Date()) => weekDays(0, now)[0]!;
export { riyadhDay };
