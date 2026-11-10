/*
 * Maintenance requests: a branch asks for a repair, the maintenance manager
 * assigns a technician, the technician starts and finishes the job, and the
 * branch confirms it is fixed (or sends it back). Pure rules shared by the
 * server and the screens.
 */

export const MAINTENANCE_STATES = [
  "NEW",
  "ASSIGNED",
  "IN_PROGRESS",
  "DONE",
  "CONFIRMED",
  "CANCELLED",
] as const;
export type MaintenanceState = (typeof MAINTENANCE_STATES)[number];

export const maintenanceStateLabels: Record<MaintenanceState, string> = {
  NEW: "جديد",
  ASSIGNED: "مُسند",
  IN_PROGRESS: "قيد التنفيذ",
  DONE: "تم الإصلاح",
  CONFIRMED: "مؤكد من الفرع",
  CANCELLED: "ملغى",
};

export const MAINTENANCE_PRIORITIES = ["URGENT", "HIGH", "NORMAL"] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];
export const maintenancePriorityLabels: Record<MaintenancePriority, string> = {
  URGENT: "عاجل",
  HIGH: "مرتفع",
  NORMAL: "عادي",
};

export type MaintenanceCategory = { id: string; label: string; active: boolean };
export const DEFAULT_MAINTENANCE_CATEGORIES: MaintenanceCategory[] = [
  { id: "AC", label: "تكييف وتبريد", active: true },
  { id: "KITCHEN", label: "معدات المطبخ", active: true },
  { id: "ELECTRICAL", label: "كهرباء وإنارة", active: true },
  { id: "PLUMBING", label: "سباكة ومياه", active: true },
  { id: "REFRIGERATION", label: "ثلاجات وفريزرات", active: true },
  { id: "BUILDING", label: "مبنى وأثاث", active: true },
  { id: "IT", label: "أجهزة الكاشير والشبكة", active: true },
  { id: "OTHER", label: "أخرى", active: true },
];

/** Deadlines in hours: start work (respond) and finish the repair (fix). */
export type MaintenanceSla = Record<MaintenancePriority, { respond: number; fix: number }>;
export const DEFAULT_MAINTENANCE_SLA: MaintenanceSla = {
  URGENT: { respond: 2, fix: 8 },
  HIGH: { respond: 8, fix: 24 },
  NORMAL: { respond: 24, fix: 72 },
};

export type MaintenanceSettings = { categories: MaintenanceCategory[]; sla: MaintenanceSla };

const hours = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 24 * 60 ? v : fallback;

/** Saved settings, or the defaults for anything missing or invalid. */
export function toMaintenanceSettings(raw: unknown): MaintenanceSettings {
  const r = (raw ?? {}) as Partial<MaintenanceSettings>;
  const saved = Array.isArray(r.categories)
    ? r.categories
        .filter((c) => typeof c?.id === "string" && /^[A-Z][A-Z0-9_]{1,39}$/.test(c.id))
        .map((c) => ({
          id: c.id,
          label: String(c.label ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60),
          active: c.active !== false,
        }))
        .filter((c) => c.label)
    : [];
  const categories = saved.length ? saved : DEFAULT_MAINTENANCE_CATEGORIES.map((c) => ({ ...c }));
  const sla = Object.fromEntries(
    MAINTENANCE_PRIORITIES.map((p) => [
      p,
      {
        respond: hours(r.sla?.[p]?.respond, DEFAULT_MAINTENANCE_SLA[p].respond),
        fix: hours(r.sla?.[p]?.fix, DEFAULT_MAINTENANCE_SLA[p].fix),
      },
    ]),
  ) as MaintenanceSla;
  return { categories, sla };
}

export function maintenanceDeadlines(
  priority: MaintenancePriority,
  from: Date,
  sla: MaintenanceSla,
) {
  const at = (h: number) => new Date(+from + h * 3600000).toISOString();
  return { respondDueAt: at(sla[priority].respond), fixDueAt: at(sla[priority].fix) };
}

export type MaintenanceRequest = {
  id: string;
  number: number;
  brandId: string;
  branchId: string;
  category: string;
  /** What the issue is, written by the requester when the fault type is "Other". */
  categoryDetail: string | null;
  priority: MaintenancePriority;
  title: string;
  description: string;
  state: MaintenanceState;
  requester: string;
  assignee: string | null;
  respondDueAt: string | null;
  fixDueAt: string | null;
  createdAt: string;
  assignedAt: string | null;
  startedAt: string | null;
  doneAt: string | null;
  confirmedAt: string | null;
  version: number;
};

/** Late: not started by the start deadline, or not finished by the fix deadline. */
export function maintenanceLate(r: MaintenanceRequest, now = Date.now()) {
  if (["DONE", "CONFIRMED", "CANCELLED"].includes(r.state)) return null;
  if (!r.startedAt && r.respondDueAt && +new Date(r.respondDueAt) < now) return "respond" as const;
  if (r.fixDueAt && +new Date(r.fixDueAt) < now) return "fix" as const;
  return null;
}

export const MAINTENANCE_ACTIONS = [
  "assign",
  "start",
  "done",
  "confirm",
  "reopen",
  "cancel",
  "comment",
] as const;
export type MaintenanceAction = (typeof MAINTENANCE_ACTIONS)[number];

export const maintenanceActionLabels: Record<MaintenanceAction, string> = {
  assign: "إسناد لفني",
  start: "بدء العمل",
  done: "تم الإصلاح",
  confirm: "تأكيد الإصلاح",
  reopen: "لم يُصلح — إعادة فتح",
  cancel: "إلغاء الطلب",
  comment: "إضافة ملاحظة",
};

type Who = { id: string; permissions: string[] };

/**
 * Which actions this person can take on this request now. Scope (brand and
 * branch) is checked separately; this only covers role and step.
 */
export function maintenanceActions(r: MaintenanceRequest, who: Who): MaintenanceAction[] {
  const has = (p: string) => who.permissions.includes(p);
  const manager = has("mnt.assign"),
    mine = r.assignee === who.id && has("mnt.work"),
    requester = has("mnt.request");
  const out: MaintenanceAction[] = [];
  const open = !["CONFIRMED", "CANCELLED"].includes(r.state);
  if (manager && ["NEW", "ASSIGNED", "IN_PROGRESS"].includes(r.state)) out.push("assign");
  if ((mine || manager) && r.state === "ASSIGNED") out.push("start");
  if ((mine || manager) && r.state === "IN_PROGRESS") out.push("done");
  if ((requester || manager) && r.state === "DONE") out.push("confirm", "reopen");
  if ((manager || (requester && r.requester === who.id)) && ["NEW", "ASSIGNED"].includes(r.state))
    out.push("cancel");
  if (open && (manager || mine || requester)) out.push("comment");
  return out;
}

/** The new state and dates after an action (assignee is set by the caller). */
export function maintenanceTransition(action: MaintenanceAction, now: Date) {
  const t = now.toISOString();
  switch (action) {
    case "assign":
      return { assigned_at: t };
    case "start":
      return { state: "IN_PROGRESS", started_at: t };
    case "done":
      return { state: "DONE", done_at: t };
    case "confirm":
      return { state: "CONFIRMED", confirmed_at: t };
    case "reopen":
      return { state: "IN_PROGRESS", done_at: null };
    case "cancel":
      return { state: "CANCELLED" };
    case "comment":
      return {};
  }
}

export const maintenanceNumber = (n: number) => "M-" + String(n).padStart(4, "0");

/** "Other": the requester is asked to write what the issue is. */
export const maintenanceAsksDetail = (c: { id: string; label: string }) =>
  c.id === "OTHER" || c.label.trim() === "أخرى";

/** Fault type as shown: "أخرى: <what the requester wrote>" for Other. */
export function maintenanceCategoryText(
  r: Pick<MaintenanceRequest, "category" | "categoryDetail">,
  categories: MaintenanceCategory[],
) {
  const label = categories.find((c) => c.id === r.category)?.label ?? r.category;
  return r.categoryDetail ? `${label}: ${r.categoryDetail}` : label;
}

const hoursBetween = (a: string, b: string) => (+new Date(b) - +new Date(a)) / 3600000;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

type Group = { key: string; total: number; open: number; fixed: number; late: number };

/** Figures for the maintenance report over the given requests. */
export function maintenanceSummary(rows: MaintenanceRequest[], now = Date.now()) {
  const fixed = rows.filter((r) => r.doneAt && ["DONE", "CONFIRMED"].includes(r.state));
  const fixHours = fixed.map((r) => hoursBetween(r.createdAt, r.doneAt!));
  const startHours = rows
    .filter((r) => r.startedAt)
    .map((r) => hoursBetween(r.createdAt, r.startedAt!));
  const onTime = fixed.filter((r) => !r.fixDueAt || +new Date(r.doneAt!) <= +new Date(r.fixDueAt));
  const group = (keyOf: (r: MaintenanceRequest) => string): Group[] => {
    const map = new Map<string, Group>();
    for (const r of rows) {
      const key = keyOf(r);
      const g = map.get(key) ?? { key, total: 0, open: 0, fixed: 0, late: 0 };
      g.total++;
      if (!["DONE", "CONFIRMED", "CANCELLED"].includes(r.state)) g.open++;
      if (["DONE", "CONFIRMED"].includes(r.state)) g.fixed++;
      if (maintenanceLate(r, now)) g.late++;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  };
  return {
    total: rows.length,
    open: rows.filter((r) => !["DONE", "CONFIRMED", "CANCELLED"].includes(r.state)).length,
    awaitingConfirm: rows.filter((r) => r.state === "DONE").length,
    confirmed: rows.filter((r) => r.state === "CONFIRMED").length,
    cancelled: rows.filter((r) => r.state === "CANCELLED").length,
    late: rows.filter((r) => maintenanceLate(r, now)).length,
    onTimeRate: fixed.length ? Math.round((onTime.length / fixed.length) * 100) : null,
    medianStartHours: median(startHours),
    medianFixHours: median(fixHours),
    byCategory: group((r) => r.category),
    byBranch: group((r) => r.branchId),
    byTechnician: group((r) => r.assignee ?? "UNASSIGNED"),
    byPriority: group((r) => r.priority),
  };
}
